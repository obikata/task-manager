import React, { useState, useEffect } from 'react';
import './App.css';

interface Task {
  id: number;
  title: string;
  description: string;
  tags: string[];
  deadline?: string;
  project: string;
  assignee: string;
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
  const [view, setView] = useState<'all' | 'project'>('all');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [meetingNotes, setMeetingNotes] = useState<string>('');
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
        await fetchTasks();
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
    const lines = meetingNotes.split('\n').filter(line => line.trim());
    const generatedTasks = lines.map((line) => ({
      title: line.trim(),
      description: `Generated from meeting notes: ${line.trim()}`,
      tags: ['meeting'],
      deadline: '',
      project: 'General',
      assignee: 'Unassigned',
    }));
    setError(null);
    try {
      const results = await Promise.allSettled(
        generatedTasks.map((task) =>
          fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(task),
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
      if (failed.length > 0) {
        setError(`Failed to create ${failed.length} of ${generatedTasks.length} tasks from meeting notes`);
      }
      await fetchTasks();
      setMeetingNotes('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate tasks from meeting notes';
      setError(msg);
      console.error('Error generating task:', err);
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

  const projects = Array.from(new Set(tasks.map(task => task.project)));
  const filteredTasks = view === 'all' ? tasks : tasks.filter(task => task.project === selectedProject);

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
      <div className="view-buttons">
        <button onClick={() => setView('all')}>All Tasks</button>
        <button onClick={() => setView('project')}>Project View</button>
        {view === 'project' && (
          <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
            <option value="">Select Project</option>
            {projects.map(project => (
              <option key={project} value={project}>{project}</option>
            ))}
          </select>
        )}
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
          <input
            type="text"
            placeholder="Project"
            value={newTask.project}
            onChange={(e) => setNewTask({ ...newTask, project: e.target.value })}
          />
          <input
            type="text"
            placeholder="Assignee"
            value={newTask.assignee}
            onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })}
          />
          <button type="submit">Add Task</button>
        </form>
      </div>
      <div className="task-form">
        <h2>Generate Tasks from Meeting Notes</h2>
        <textarea
          placeholder="Paste meeting notes here..."
          value={meetingNotes}
          onChange={(e) => setMeetingNotes(e.target.value)}
          rows={5}
        />
        <button onClick={generateTasksFromNotes}>Generate Tasks</button>
      </div>
      <div className="task-list">
        {view === 'project' && selectedProject === '' && (
          <p className="empty-state-message">プロジェクトを選択してください</p>
        )}
        {loading && tasks.length === 0 && (
          <p className="loading-message">読み込み中...</p>
        )}
        {!loading && view === 'project' && selectedProject !== '' && filteredTasks.length === 0 && (
          <p className="empty-state-message">このプロジェクトにタスクはありません</p>
        )}
        {!loading && (view === 'all' || (view === 'project' && selectedProject !== '')) && filteredTasks.map((task) => (
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
                <input
                  type="text"
                  placeholder="Project"
                  value={editingTask.project ?? ''}
                  onChange={(e) => setEditingTask({ ...editingTask, project: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Assignee"
                  value={editingTask.assignee ?? ''}
                  onChange={(e) => setEditingTask({ ...editingTask, assignee: e.target.value })}
                />
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
                {task.deadline && <p className="deadline">Deadline: {task.deadline}</p>}
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