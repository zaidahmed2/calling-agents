export type CallbackStatus = "scheduled" | "due" | "overdue" | "completed";

export type CallbackTask = {
  id: string;
  contactId: string;
  agentId: string;
  contactName: string;
  dueAt: string;
  timezone: string;
  status: CallbackStatus;
  sourceCallId?: string;
  notes?: string;
};

export function getCallbackStatus(task: CallbackTask, now = new Date()): CallbackStatus {
  if (task.status === "completed") {
    return "completed";
  }

  const dueAt = new Date(task.dueAt).getTime();
  const differenceInMinutes = (dueAt - now.getTime()) / 60000;

  if (differenceInMinutes < 0) {
    return "overdue";
  }

  if (differenceInMinutes <= 30) {
    return "due";
  }

  return "scheduled";
}

export function summariseCallbacks(tasks: CallbackTask[], now = new Date()) {
  const nextDue = [...tasks].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
  const overdueCount = tasks.filter((task) => getCallbackStatus(task, now) === "overdue").length;
  const dueCount = tasks.filter((task) => getCallbackStatus(task, now) === "due").length;

  return {
    nextDue,
    overdueCount,
    dueCount,
    total: tasks.length,
  };
}

export function summarisePersistedCallbacks(tasks: Array<{ due_at: string; status: string }>, now = Date.now()) {
  return {
    dueCount: tasks.filter((task) => new Date(task.due_at).getTime() <= now).length,
    overdueCount: tasks.filter((task) => task.status === "missed" || new Date(task.due_at).getTime() < now).length,
  };
}
