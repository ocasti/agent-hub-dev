import { readFileSync } from 'fs';
import { join } from 'path';
import { app, net } from 'electron';

// ── Types ────────────────────────────────────────────────────────────────────────

interface McpServerConfig {
  type: string;
  url: string;
  headers?: Record<string, string>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: {
    content?: { type: string; text: string }[];
    structuredContent?: { result?: unknown };
    [key: string]: unknown;
  };
  error?: { code: number; message: string };
}

// ── Cache ────────────────────────────────────────────────────────────────────────

const optionsCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Session cache: server URL → session ID
const sessionCache = new Map<string, { sessionId: string; timestamp: number }>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCacheKey(server: string, tool: string, args?: Record<string, unknown>): string {
  return `${server}:${tool}:${JSON.stringify(args || {})}`;
}

// ── Read MCP Server Config ───────────────────────────────────────────────────────

export function getMcpServerConfig(serverName: string): McpServerConfig {
  const claudeJsonPath = join(app.getPath('home'), '.claude.json');

  let claudeConfig: {
    mcpServers?: Record<string, McpServerConfig>;
    projects?: Record<string, { mcpServers?: Record<string, McpServerConfig> }>;
  };
  try {
    claudeConfig = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));
  } catch {
    throw new Error(`Cannot read ~/.claude.json`);
  }

  // Search in global mcpServers first
  let server = claudeConfig.mcpServers?.[serverName];

  // Fallback: search in project-level mcpServers
  if (!server && claudeConfig.projects) {
    for (const proj of Object.values(claudeConfig.projects)) {
      if (proj.mcpServers?.[serverName]) {
        server = proj.mcpServers[serverName];
        break;
      }
    }
  }

  if (!server) {
    throw new Error(`MCP server "${serverName}" not found in ~/.claude.json (checked global and project-level configs)`);
  }

  // Accept both http and sse transports
  if (server.type !== 'http' && server.type !== 'sse') {
    throw new Error(`MCP server "${serverName}" is type "${server.type}". Only HTTP/SSE servers are supported for dynamic config options.`);
  }

  if (!server.url) {
    throw new Error(`MCP server "${serverName}" has no URL configured`);
  }

  return server;
}

// ── Low-level HTTP POST ──────────────────────────────────────────────────────────

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

function httpPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'POST', url });

    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }

    let responseData = '';
    let responseHeaders: Record<string, string | string[]> = {};
    let statusCode = 0;

    request.on('response', (response) => {
      statusCode = response.statusCode;
      responseHeaders = response.headers as Record<string, string | string[]>;

      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      response.on('end', () => {
        resolve({ statusCode, headers: responseHeaders, body: responseData });
      });

      response.on('error', reject);
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

// ── MCP Session Management ───────────────────────────────────────────────────────

async function getSessionId(config: McpServerConfig): Promise<string> {
  // Check session cache
  const cached = sessionCache.get(config.url);
  if (cached && Date.now() - cached.timestamp < SESSION_TTL_MS) {
    return cached.sessionId;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...config.headers,
  };

  // Step 1: Initialize
  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-hub', version: '1.0.0' },
    },
  });

  const initResponse = await httpPost(config.url, headers, initBody);
  if (initResponse.statusCode !== 200) {
    throw new Error(`MCP initialize failed with status ${initResponse.statusCode}`);
  }

  // Extract session ID from response header
  const sessionId = extractHeader(initResponse.headers, 'mcp-session-id');
  if (!sessionId) {
    throw new Error('MCP server did not return a session ID');
  }

  // Step 2: Send initialized notification
  const notifyBody = JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  await httpPost(config.url, { ...headers, 'mcp-session-id': sessionId }, notifyBody);

  // Cache the session
  sessionCache.set(config.url, { sessionId, timestamp: Date.now() });

  return sessionId;
}

function extractHeader(headers: Record<string, string | string[]>, key: string): string | null {
  const value = headers[key];
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

// ── Call MCP Tool via HTTP ───────────────────────────────────────────────────────

export async function callMcpHttpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const sessionId = await getSessionId(config);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'mcp-session-id': sessionId,
    ...config.headers,
  };

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  });

  const response = await httpPost(config.url, headers, body);

  if (response.statusCode === 400) {
    // Session might have expired — clear cache and retry once
    sessionCache.delete(config.url);
    const newSessionId = await getSessionId(config);
    const retryHeaders = { ...headers, 'mcp-session-id': newSessionId };
    const retryResponse = await httpPost(config.url, retryHeaders, body);

    if (retryResponse.statusCode !== 200) {
      throw new Error(`MCP server returned status ${retryResponse.statusCode}`);
    }

    return parseResponse(retryResponse.body, extractHeader(retryResponse.headers, 'content-type') || '');
  }

  if (response.statusCode !== 200) {
    throw new Error(`MCP server returned status ${response.statusCode}`);
  }

  return parseResponse(response.body, extractHeader(response.headers, 'content-type') || '');
}

// ── Parse Response (JSON or SSE) ─────────────────────────────────────────────────

function parseResponse(raw: string, contentType: string): unknown {
  // SSE response
  if (contentType.includes('text/event-stream')) {
    return parseSseResponse(raw);
  }

  // Plain JSON response
  const rpc = JSON.parse(raw) as JsonRpcResponse;
  return extractFromRpc(rpc);
}

function parseSseResponse(raw: string): unknown {
  // Extract data from SSE lines — accumulate multi-line data blocks
  const lines = raw.split('\n');
  let lastData = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      lastData = line.slice(6);
    }
  }

  if (!lastData) {
    throw new Error('No data found in SSE response');
  }

  const rpc = JSON.parse(lastData) as JsonRpcResponse;
  return extractFromRpc(rpc);
}

function extractFromRpc(rpc: JsonRpcResponse): unknown {
  if (rpc.error) {
    throw new Error(`MCP error: ${rpc.error.message}`);
  }

  // Prefer structuredContent.result (already parsed array)
  if (rpc.result?.structuredContent?.result) {
    return rpc.result.structuredContent.result;
  }

  // Fallback: parse from content text blocks
  if (rpc.result?.content?.length) {
    // If there's a single text block, parse it as JSON
    if (rpc.result.content.length === 1) {
      const text = rpc.result.content[0].text;
      if (text) return JSON.parse(text);
    }

    // Multiple text blocks — each is a JSON object, collect into array
    const items: unknown[] = [];
    for (const block of rpc.result.content) {
      if (block.type === 'text' && block.text) {
        try {
          items.push(JSON.parse(block.text));
        } catch {
          // skip unparseable blocks
        }
      }
    }
    if (items.length > 0) return items;
  }

  throw new Error('MCP response has no extractable content');
}

// ── Extract Options ──────────────────────────────────────────────────────────────

export function extractOptionsFromResult(
  result: unknown,
  labelField: string,
  valueField: string
): { label: string; value: string }[] {
  let items: unknown[];

  if (Array.isArray(result)) {
    items = result;
  } else if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const arrayProp = Object.values(obj).find((v) => Array.isArray(v));
    if (arrayProp) {
      items = arrayProp as unknown[];
    } else {
      throw new Error('MCP result is not an array and contains no array property');
    }
  } else {
    throw new Error('MCP result is not an array or object');
  }

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const label = getNestedValue(record, labelField);
      const value = getNestedValue(record, valueField);
      if (label == null || value == null) return null;
      return { label: String(label), value: String(value) };
    })
    .filter((opt): opt is { label: string; value: string } => opt !== null);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

// ── Public API ───────────────────────────────────────────────────────────────────

export async function fetchConfigOptions(
  serverName: string,
  toolName: string,
  labelField: string,
  valueField: string,
  args?: Record<string, string>
): Promise<{ label: string; value: string }[]> {
  // Check cache
  const cacheKey = getCacheKey(serverName, toolName, args);
  const cached = optionsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return extractOptionsFromResult(cached.data, labelField, valueField);
  }

  // Fetch from MCP
  const config = getMcpServerConfig(serverName);
  const result = await callMcpHttpTool(config, toolName, args || {});

  // Cache the raw result
  optionsCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return extractOptionsFromResult(result, labelField, valueField);
}
