import React, { useState, useEffect, useRef } from 'react';
import DatePicker, { registerLocale, setDefaultLocale } from 'react-datepicker';
import { format, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import './App.css';

registerLocale('en-US', enUS);
setDefaultLocale('en-US');

interface MultiSelectFilterProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter(s => s !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  const displayText = selected.length === 0 ? 'All' : selected.length <= 2 ? selected.join(', ') : `${selected.length} selected`;

  return (
    <div className="filter-label" ref={ref}>
      <span className="filter-label-text">{label}</span>
      <div className="multi-select">
        <button type="button" className="multi-select-trigger" onClick={() => setOpen(!open)}>
          {displayText} ▾
        </button>
        {open && (
          <div className="multi-select-dropdown">
            {options.map(opt => (
              <label key={opt} className="multi-select-option">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
                <span>{opt}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TASK_STATUSES = [
  { value: 'todo', label: 'TO DO' },
  { value: 'in_progress', label: 'IN PROGRESS' },
  { value: 'done', label: 'DONE' },
  { value: 'blocked', label: 'BLOCKED' },
] as const;

type TaskStatus = (typeof TASK_STATUSES)[number]['value'];

interface Task {
  id: number;
  title: string;
  description: string;
  tags: string[];
  deadline?: string;
  project: string;
  assignee: string;
  status: TaskStatus | string;
  in_sprint?: boolean;
}

/** Calculate remaining working days until deadline (excludes weekends). */
function getWorkingDaysUntil(deadlineStr: string): number {
  const deadline = new Date(deadlineStr + 'T12:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  if (deadline < today) return -1;
  let count = 0;
  const d = new Date(today);
  d.setDate(d.getDate() + 1);
  while (d <= deadline) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function getDeadlineClassName(deadlineStr: string): string {
  const remaining = getWorkingDaysUntil(deadlineStr);
  if (remaining < 5) return 'deadline deadline-urgent';
  if (remaining < 10) return 'deadline deadline-warning';
  return 'deadline deadline-default';
}

const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    tags: '',
    deadline: '',
    project: '',
    assignee: '',
    status: 'todo' as TaskStatus,
  });
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [filterAssignee, setFilterAssignee] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [meetingNotes, setMeetingNotes] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('darkMode');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [openAddTask, setOpenAddTask] = useState(false);
  const [openAiGenerate, setOpenAiGenerate] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, []);

  const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080';

  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/tasks`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      setTasks(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch tasks';
      setError(msg);
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let tags = newTask.tags.split(',').map(tag => tag.trim());
    // Auto-generate tags from title
    const titleLower = newTask.title.toLowerCase();
    if (titleLower.includes('bug')) tags.push('bug');
    if (titleLower.includes('feature')) tags.push('feature');
    if (titleLower.includes('urgent')) tags.push('urgent');
    tags = Array.from(new Set(tags)); // unique
    const task = {
      ...newTask,
      project: newTask.project.trim(),
      assignee: newTask.assignee.trim(),
      tags,
      deadline: newTask.deadline || undefined,
      status: newTask.status || 'todo',
    };
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
      });
      if (response.ok) {
        const createdTask = (await response.json()) as Task;
        setTasks((prev) => [...prev, createdTask]);
        setNewTask({
          title: '',
          description: '',
          tags: '',
          deadline: '',
          project: '',
          assignee: '',
          status: 'todo',
        });
      } else {
        const text = await response.text();
        throw new Error(`Failed to create task: ${response.status} ${text || response.statusText}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create task';
      setError(msg);
      console.error('Error creating task:', err);
    }
  };

  const generateTasksFromNotes = async () => {
    const notes = meetingNotes.trim();
    if (!notes) {
      setError('Please enter meeting notes');
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const response = await fetch(`${API_BASE}/tasks/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_notes: notes }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Failed to generate tasks: ${response.status}`);
      }
      await fetchTasks();
      setMeetingNotes('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate tasks from meeting notes';
      setError(msg);
      console.error('Error generating task:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateTask = async (e: React.FormEvent, taskId: number) => {
    e.preventDefault();
    if (!editingTask) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editingTask,
          id: taskId,
          project: (editingTask.project ?? '').trim(),
          assignee: (editingTask.assignee ?? '').trim(),
          status: editingTask.status ?? 'todo',
          in_sprint: editingTask.in_sprint ?? false,
          tags: Array.isArray(editingTask.tags) ? editingTask.tags : String(editingTask.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (response.ok) {
        await fetchTasks();
        setEditingTaskId(null);
        setEditingTask(null);
      } else {
        const text = await response.text();
        throw new Error(`Failed to update task: ${response.status} ${text || response.statusText}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update task';
      setError(msg);
    }
  };

  const handleSprintChange = async (taskId: number, inSprint: boolean) => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/sprint`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_sprint: inSprint }),
      });
      if (response.ok) {
        await fetchTasks();
      } else {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as { error?: string })?.error || `Failed to update: ${response.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update';
      setError(msg);
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        await fetchTasks();
      } else {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as { error?: string })?.error || `Failed to update status: ${response.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update status';
      setError(msg);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!window.confirm('Delete this task?')) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' });
      if (response.ok || response.status === 204) {
        await fetchTasks();
      } else {
        throw new Error(`Failed to delete task: ${response.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete task';
      setError(msg);
    }
  };

  const startEditing = (task: Task) => {
    setEditingTaskId(task.id);
    setEditingTask({
      ...task,
      tags: task.tags,
    });
  };

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('darkMode', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const projects = Array.from(new Set(['General', ...tasks.map(t => t.project).filter(p => p && p.trim())])).sort();
  const assignees = Array.from(new Set(['Unassigned', ...tasks.map(t => t.assignee).filter(a => a && a.trim())])).sort();
  const tags = Array.from(new Set(tasks.flatMap(t => t.tags).filter(t => t && t.trim()))).sort();
  const statusLabels = TASK_STATUSES.map(s => s.label);
  const taskSort = (a: Task, b: Task) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  };

  const filteredTasks = tasks.filter(task => {
    const projectMatch = filterProject.length === 0 || filterProject.includes(task.project);
    const assigneeMatch = filterAssignee.length === 0 || filterAssignee.includes(task.assignee);
    const tagMatch = filterTags.length === 0 || filterTags.some(tag => task.tags.includes(tag));
    const taskStatusLabel = TASK_STATUSES.find(s => s.value === (task.status || 'todo'))?.label ?? task.status;
    const statusMatch = filterStatus.length === 0 || filterStatus.includes(taskStatusLabel);
    return projectMatch && assigneeMatch && tagMatch && statusMatch;
  });

  const backlogTasks = filteredTasks.filter(t => !t.in_sprint).sort(taskSort);
  const sprintTasks = filteredTasks.filter(t => !!t.in_sprint).sort(taskSort);

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData('taskId', String(taskId));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetInSprint: boolean) => {
    e.preventDefault();
    const taskId = parseInt(e.dataTransfer.getData('taskId'), 10);
    if (isNaN(taskId)) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.in_sprint === targetInSprint) return;
    handleSprintChange(taskId, targetInSprint);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const renderTaskCard = (task: Task) => (
    <div
      key={task.id}
      className={`task-card status-${editingTaskId === task.id && editingTask ? (editingTask.status ?? 'todo') : (task.status || 'todo')}`}
      draggable={editingTaskId !== task.id}
      onDragStart={(e) => editingTaskId !== task.id && handleDragStart(e, task.id)}
    >
      {editingTaskId === task.id && editingTask ? (
        <form onSubmit={(e) => handleUpdateTask(e, task.id)} className="task-edit-form">
          <div>
            <label className="filter-label-text">Title</label>
            <input
              type="text"
              placeholder="Enter title"
              value={editingTask.title ?? ''}
              onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="filter-label-text">Description</label>
            <textarea
              placeholder="Enter description"
              value={editingTask.description ?? ''}
              onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
            />
          </div>
          <div>
            <label className="filter-label-text">Tags</label>
            <input
              type="text"
              placeholder="Comma separated"
              value={Array.isArray(editingTask.tags) ? editingTask.tags.join(', ') : ''}
              onChange={(e) => setEditingTask({ ...editingTask, tags: e.target.value.split(',').map(t => t.trim()) })}
            />
          </div>
          <div>
            <label className="filter-label-text">Deadline</label>
            <DatePicker
              placeholderText="Select date"
              dateFormat="yyyy-MM-dd"
              locale={enUS}
              selected={editingTask.deadline ? parseISO(editingTask.deadline) : null}
              onChange={(d: Date | null) => setEditingTask({ ...editingTask, deadline: d ? format(d, 'yyyy-MM-dd') : undefined })}
              className="react-datepicker-input"
            />
          </div>
          <div className="filter-bar" style={{ marginTop: 12, marginBottom: 0 }}>
            <label className="filter-label">
              <span className="filter-label-text">Status</span>
              <select
                value={editingTask.status ?? 'todo'}
                onChange={(e) => setEditingTask({ ...editingTask, status: e.target.value })}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="filter-label">
              <span className="filter-label-text">Project</span>
              <select
                value={editingTask.project ?? ''}
                onChange={(e) => setEditingTask({ ...editingTask, project: e.target.value })}
              >
                <option value="">All</option>
                {Array.from(new Set([...(editingTask.project && !projects.includes(editingTask.project) ? [editingTask.project] : []), ...projects])).sort().map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="filter-label">
              <span className="filter-label-text">Assignee</span>
              <select
                value={editingTask.assignee ?? ''}
                onChange={(e) => setEditingTask({ ...editingTask, assignee: e.target.value })}
              >
                <option value="">All</option>
                {Array.from(new Set([...(editingTask.assignee && !assignees.includes(editingTask.assignee) ? [editingTask.assignee] : []), ...assignees])).sort().map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="task-card-actions">
            <button type="submit">Save</button>
            <button type="button" onClick={() => { setEditingTaskId(null); setEditingTask(null); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div className="task-card-header">
            <h3>{task.title}</h3>
            <select
              className="status-select"
              value={task.status || 'todo'}
              onChange={(e) => handleStatusChange(task.id, e.target.value)}
              title="Change status"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <p>{task.description}</p>
          <div className="tags">
            {task.tags.map((tag) => (
              <span key={`${task.id}-${tag}`} className="tag">{tag}</span>
            ))}
          </div>
          {task.deadline && <p className={getDeadlineClassName(task.deadline)}>Deadline: {task.deadline}</p>}
          <p>Project: {task.project}</p>
          <p>Assignee: {task.assignee}</p>
          <div className="task-card-actions">
            <button type="button" onClick={() => startEditing(task)}>Edit</button>
            <button type="button" className="delete-btn" onClick={() => handleDeleteTask(task.id)}>Delete</button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className={`App ${isDarkMode ? 'dark' : ''}`}>
      <div className="app-container">
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Task Manager</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="dark-mode-label">Dark Mode</span>
          <label className="toggle-switch">
            <input type="checkbox" checked={isDarkMode} onChange={toggleDarkMode} />
            <span className="slider"></span>
          </label>
        </div>
      </div>
      <div className="filter-bar">
        <MultiSelectFilter label="Project" options={projects} selected={filterProject} onChange={setFilterProject} />
        <MultiSelectFilter label="Assignee" options={assignees} selected={filterAssignee} onChange={setFilterAssignee} />
        <MultiSelectFilter label="Status" options={statusLabels} selected={filterStatus} onChange={setFilterStatus} />
        <MultiSelectFilter label="Tag" options={tags} selected={filterTags} onChange={setFilterTags} />
        <button
          type="button"
          className="filter-reset-btn"
          onClick={() => { setFilterProject([]); setFilterAssignee([]); setFilterTags([]); setFilterStatus([]); }}
          disabled={filterProject.length === 0 && filterAssignee.length === 0 && filterTags.length === 0 && filterStatus.length === 0}
        >
          Reset
        </button>
      </div>
      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setOpenAddTask((prev) => !prev)}
          aria-expanded={openAddTask}
        >
          <h2>Add New Task</h2>
          <span className="collapsible-icon">{openAddTask ? '▼' : '▶'}</span>
        </button>
        {openAddTask && (
        <div className="task-form collapsible-content">
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="new-title">Title</label>
            <input
              id="new-title"
              type="text"
              placeholder="Enter title"
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              required
            />
          </div>
          <div>
            <label htmlFor="new-description">Description</label>
            <textarea
              id="new-description"
              placeholder="Enter description"
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="new-tags">Tags</label>
            <input
              id="new-tags"
              type="text"
              placeholder="Comma separated"
              value={newTask.tags}
              onChange={(e) => setNewTask({ ...newTask, tags: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="new-deadline">Deadline</label>
            <DatePicker
              id="new-deadline"
              placeholderText="Select date"
              dateFormat="yyyy-MM-dd"
              locale={enUS}
              selected={newTask.deadline ? parseISO(newTask.deadline) : null}
              onChange={(d: Date | null) => setNewTask({ ...newTask, deadline: d ? format(d, 'yyyy-MM-dd') : '' })}
              className="react-datepicker-input"
            />
          </div>
          <div>
            <label htmlFor="new-project">Project</label>
            <select
              id="new-project"
              value={projects.includes(newTask.project) ? newTask.project : (newTask.project ? '__new__' : '')}
              onChange={(e) => {
                const v = e.target.value;
                setNewTask({ ...newTask, project: v === '__new__' ? ' ' : v });
              }}
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value="__new__">+ New</option>
            </select>
            {(!newTask.project || projects.includes(newTask.project)) ? null : (
              <input
                type="text"
                placeholder="New project name"
                value={newTask.project}
                onChange={(e) => setNewTask({ ...newTask, project: e.target.value })}
                style={{ marginTop: 4 }}
              />
            )}
          </div>
          <div>
            <label htmlFor="new-status">Status</label>
            <select
              id="new-status"
              value={newTask.status}
              onChange={(e) => setNewTask({ ...newTask, status: e.target.value as TaskStatus })}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-assignee">Assignee</label>
            <select
              id="new-assignee"
              value={assignees.includes(newTask.assignee) ? newTask.assignee : (newTask.assignee ? '__new__' : '')}
              onChange={(e) => {
                const v = e.target.value;
                setNewTask({ ...newTask, assignee: v === '__new__' ? ' ' : v });
              }}
            >
              <option value="">Select assignee</option>
              {assignees.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
              <option value="__new__">+ New</option>
            </select>
            {(!newTask.assignee || assignees.includes(newTask.assignee)) ? null : (
              <input
                type="text"
                placeholder="New assignee name"
                value={newTask.assignee}
                onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}
                style={{ marginTop: 4 }}
              />
            )}
          </div>
          <button type="submit">Add Task</button>
        </form>
        </div>
        )}
      </div>
      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setOpenAiGenerate((prev) => !prev)}
          aria-expanded={openAiGenerate}
        >
          <h2>Generate Tasks from Meeting Notes (AI)</h2>
          <span className="collapsible-icon">{openAiGenerate ? '▼' : '▶'}</span>
        </button>
        {openAiGenerate && (
        <div className="task-form collapsible-content">
        <div>
          <label htmlFor="meeting-notes">Meeting notes</label>
          <textarea
            id="meeting-notes"
            placeholder="Paste meeting notes or text here"
            value={meetingNotes}
            onChange={(e) => setMeetingNotes(e.target.value)}
            rows={5}
            disabled={generating}
          />
        </div>
        <button onClick={generateTasksFromNotes} disabled={generating}>
          {generating ? 'Generating...' : 'Generate Tasks with AI'}
        </button>
        </div>
        )}
      </div>
      <div className="board-container">
        <div
          className="board-column"
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, true)}
        >
          <h3 className="board-column-title">Sprint</h3>
          <div className="task-list">
            {!loading && sprintTasks.map((task) => renderTaskCard(task))}
          </div>
        </div>
        <div
          className="board-column"
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, false)}
        >
          <h3 className="board-column-title">Backlog</h3>
          <div className="task-list">
            {loading && tasks.length === 0 && (
              <p className="loading-message">Loading...</p>
            )}
            {!loading && backlogTasks.length === 0 && sprintTasks.length === 0 && (
              <p className="empty-state-message">No tasks found</p>
            )}
            {!loading && backlogTasks.map((task) => renderTaskCard(task))}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default App;