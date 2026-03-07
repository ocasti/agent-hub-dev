import { useEffect, useRef, useState } from 'react';
import type { AgentLogMessage, ActiveAgent } from '../lib/types';

export function useAgentLogs() {
  const [agents, setAgents] = useState<Map<string, ActiveAgent>>(new Map());
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanup = window.electronAPI.onAgentLog((log: AgentLogMessage) => {
      setAgents((prev) => {
        const next = new Map(prev);
        const existing = next.get(log.taskId);
        if (existing) {
          next.set(log.taskId, { ...existing, ...log });
        }
        return next;
      });
    });

    cleanupRef.current = cleanup;
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  const addAgent = (taskId: string, agent: ActiveAgent) => {
    setAgents((prev) => {
      const next = new Map(prev);
      next.set(taskId, agent);
      return next;
    });
  };

  const removeAgent = (taskId: string) => {
    setAgents((prev) => {
      const next = new Map(prev);
      next.delete(taskId);
      return next;
    });
  };

  const getAgent = (taskId: string): ActiveAgent | undefined => {
    return agents.get(taskId);
  };

  return { agents, addAgent, removeAgent, getAgent };
}
