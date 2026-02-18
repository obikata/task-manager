import React, { useState, useEffect, useRef } from 'react';
import './App.css';

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

interface Task {
  id: number;
  title: string;
  description: string;
  tags: string[];
  deadline?: string;
  project: string;
  assignee: string;
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
  });
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [filterAssignee, setFilterAssignee] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
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
      setError('会議メモを入力してください');
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

  const handleDeleteTask = async (taskId: number) => {
    if (!window.confirm('このタスクを削除しますか？')) return;
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
  const filteredTasks = tasks
    .filter(task => {
      const projectMatch = filterProject.length === 0 || filterProject.includes(task.project);
      const assigneeMatch = filterAssignee.length === 0 || filterAssignee.includes(task.assignee);
      const tagMatch = filterTags.length === 0 || filterTags.some(tag => task.tags.includes(tag));
      return projectMatch && assigneeMatch && tagMatch;
    })
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });

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
        <MultiSelectFilter label="Tag" options={tags} selected={filterTags} onChange={setFilterTags} />
        <button
          type="button"
          className="filter-reset-btn"
          onClick={() => { setFilterProject([]); setFilterAssignee([]); setFilterTags([]); }}
          disabled={filterProject.length === 0 && filterAssignee.length === 0 && filterTags.length === 0}
        >
          Reset
        </button>
      </div>
      <div className="task-form">
        <h2>Add New Task</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Title"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            required
          />
          <textarea
            placeholder="Description"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
          />
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={newTask.tags}
            onChange={(e) => setNewTask({ ...newTask, tags: e.target.value })}
          />
          <input
            type="date"
            value={newTask.deadline}
            onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
          />
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
              <option value="__new__">＋新規</option>
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
              <option value="__new__">＋新規</option>
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
      <div className="task-form">
        <h2>Generate Tasks from Meeting Notes (AI)</h2>
        <textarea
          placeholder="会議メモやテキストを貼り付けてください。xAI (Grok) がタスクを自動抽出します..."
          value={meetingNotes}
          onChange={(e) => setMeetingNotes(e.target.value)}
          rows={5}
          disabled={generating}
        />
        <button onClick={generateTasksFromNotes} disabled={generating}>
          {generating ? '生成中...' : 'AIでタスクを生成'}
        </button>
      </div>
      <div className="task-list">
        {loading && tasks.length === 0 && (
          <p className="loading-message">読み込み中...</p>
        )}
        {!loading && filteredTasks.length === 0 && (
          <p className="empty-state-message">該当するタスクはありません</p>
        )}
        {!loading && filteredTasks.length > 0 && filteredTasks.map((task) => (
          <div key={task.id} className="task-card">
            {editingTaskId === task.id && editingTask ? (
              <form onSubmit={(e) => handleUpdateTask(e, task.id)} className="task-edit-form">
                <input
                  type="text"
                  placeholder="Title"
                  value={editingTask.title ?? ''}
                  onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                  required
                />
                <textarea
                  placeholder="Description"
                  value={editingTask.description ?? ''}
                  onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Tags (comma separated)"
                  value={Array.isArray(editingTask.tags) ? editingTask.tags.join(', ') : ''}
                  onChange={(e) => setEditingTask({ ...editingTask, tags: e.target.value.split(',').map(t => t.trim()) })}
                />
                <input
                  type="date"
                  value={editingTask.deadline ?? ''}
                  onChange={(e) => setEditingTask({ ...editingTask, deadline: e.target.value || undefined })}
                />
                <div className="filter-bar" style={{ marginTop: 12, marginBottom: 0 }}>
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
                <h3>{task.title}</h3>
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
        ))}
      </div>
      </div>
    </div>
  );
};

export default App;