"use client";

import styles from "@/components/agent-checkbox-group.module.css";

type AgentOption = { id: string; email: string; name?: string };

export default function AgentCheckboxGroup({
  agents,
  selectedIds,
  onChange,
  label = "Assign to agents",
}: {
  agents: AgentOption[];
  selectedIds: string[];
  onChange: (agentIds: string[]) => void;
  label?: string;
}) {
  const selected = new Set(selectedIds);
  const summary = selectedIds.length
    ? `${selectedIds.length} agent${selectedIds.length === 1 ? "" : "s"} selected`
    : "No agents selected";

  function toggle(agentId: string) {
    onChange(selected.has(agentId)
      ? selectedIds.filter((id) => id !== agentId)
      : [...selectedIds, agentId]);
  }

  return <details className={styles.group}>
    <summary><span>{label}</span><strong>{summary}</strong></summary>
    <div className={styles.options}>
      {agents.length ? agents.map((agent) => <label key={agent.id}>
        <input type="checkbox" checked={selected.has(agent.id)} onChange={() => toggle(agent.id)} />
        <span>{agent.name && agent.name.trim().toLowerCase() !== agent.email.trim().toLowerCase() ? `${agent.name} · ${agent.email}` : agent.email}</span>
      </label>) : <span className={styles.empty}>No active agents available.</span>}
    </div>
  </details>;
}
