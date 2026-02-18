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
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      console.log('Fetching tasks...');
      const response = await fetch('http://127.0.0.1:8080/tasks');
      const data = await response.json();
      console.log('Fetched tasks:', data);
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
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
    try {
      console.log('Sending task:', task);
      const response = await fetch('http://127.0.0.1:8080/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
      });
      console.log('Response status:', response.status);
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
        console.error('Failed to create task:', response.statusText);
      }
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const generateTasksFromNotes = () => {
    const lines = meetingNotes.split('\n').filter(line => line.trim());
    const generatedTasks = lines.map((line) => ({
      title: line.trim(),
      description: `Generated from meeting notes: ${line.trim()}`,
      tags: ['meeting'],
      deadline: '',
      project: 'General',
      assignee: 'Unassigned',
    }));
    // 提案を表示するか、直接追加
    // ここでは直接追加
    generatedTasks.forEach(async (task) => {
      try {
        const response = await fetch('http://127.0.0.1:8080/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(task),
        });
        if (response.ok) {
          await fetchTasks();
        }
      } catch (error) {
        console.error('Error generating task:', error);
      }
    });
    setMeetingNotes('');
  };

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  const projects = Array.from(new Set(tasks.map(task => task.project)));
  const filteredTasks = view === 'all' ? tasks : tasks.filter(task => task.project === selectedProject);

  return (
    <div className={`App ${isDarkMode ? 'dark' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Task Manager</h1>
        <label className="toggle-switch">
          <input type="checkbox" checked={isDarkMode} onChange={toggleDarkMode} />
          <span className="slider"></span>
        </label>
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
        {filteredTasks.map((task) => (
          <div key={task.id} className="task-card">
            <h3>{task.title}</h3>
            <p>{task.description}</p>
            <div className="tags">
              {task.tags.map((tag, i) => (
                <span key={i} className="tag">{tag}</span>
              ))}
            </div>
            {task.deadline && <p className="deadline">Deadline: {task.deadline}</p>}
            <p>Project: {task.project}</p>
            <p>Assignee: {task.assignee}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default App;