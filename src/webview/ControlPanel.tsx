import React, { useState, useEffect } from 'react';
import './ControlPanel.css';

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface Environment {
  id: string;
  name: string;
  slug: string;
}

interface Secret {
  id: string;
  key: string;
  value: string;
  environment: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  isAuthenticated: boolean;
  clientId: string;
  clientSecret: string;
  region: 'US' | 'EU';
}

export const ControlPanel: React.FC = () => {
  const [vscode] = useState(() => window.acquireVsCodeApi());
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    clientId: '',
    clientSecret: '',
    region: 'US'
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('');
  const [projectInput, setProjectInput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [projectError, setProjectError] = useState<string>('');

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      console.log('Received message:', message.type, message.data);
      
      try {
        switch (message.type) {
          case 'authStateChanged':
            setAuthState(message.data);
            if (message.data.isAuthenticated) {
              loadProjects();
            } else {
              resetState();
            }
            break;
            
          case 'projectsLoaded':
            setProjects(Array.isArray(message.data) ? message.data : []);
            setLoading(false);
            break;
            
          case 'projectLoaded':
            if (message.data && message.data.environments) {
              setEnvironments(message.data.environments);
              setSelectedProject(message.data.id);
              setProjectInput(message.data.name || message.data.id);
              setProjectError('');
              setProjectLoading(false);
              setLoading(false);
              
              // Auto-select the first environment if available
              if (message.data.environments.length > 0) {
                setSelectedEnvironment(message.data.environments[0].id);
                loadSecrets(message.data.id, message.data.environments[0].id);
              }
            } else {
              throw new Error('Invalid project data received');
            }
            break;
            
          case 'projectError':
            setProjectError(message.data?.message || 'Failed to load project');
            setProjectLoading(false);
            setLoading(false);
            setEnvironments([]);
            setSelectedEnvironment('');
            setSecrets([]);
            break;
            
          case 'environmentsLoaded':
            setEnvironments(Array.isArray(message.data) ? message.data : []);
            setLoading(false);
            break;
            
          case 'secretsLoaded':
            setSecrets(Array.isArray(message.data) ? message.data : []);
            setLoading(false);
            break;
            
          case 'error':
            setError(message.data || 'An unknown error occurred');
            setLoading(false);
            setProjectLoading(false);
            break;
            
          default:
            console.warn('Unhandled message type:', message.type);
        }
      } catch (error) {
        console.error('Error processing message:', error);
        setError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setLoading(false);
        setProjectLoading(false);
      }
    };

    window.addEventListener('message', messageHandler);
    
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', messageHandler);
  }, [vscode]);

  const handleLogin = async () => {
    if (!authState.clientId || !authState.clientSecret) {
      setError('Please enter both Client ID and Client Secret');
      return;
    }

    setLoading(true);
    setError('');
    
    vscode.postMessage({
      type: 'authenticate',
      data: {
        clientId: authState.clientId,
        clientSecret: authState.clientSecret,
        region: authState.region
      }
    });
  };

  const handleLogout = () => {
    vscode.postMessage({ type: 'logout' });
    resetState();
  };

  const resetState = () => {
    setProjects([]);
    setEnvironments([]);
    setSecrets([]);
    setSelectedProject('');
    setSelectedEnvironment('');
    setProjectInput('');
    setProjectError('');
    setError('');
    setLoading(false);
    setProjectLoading(false);
  };

  const loadProjects = () => {
    vscode.postMessage({ type: 'loadProjects' });
  };

  const loadEnvironments = (projectId: string) => {
    if (!projectId) return;
    
    setLoading(true);
    vscode.postMessage({ 
      type: 'loadEnvironments', 
      data: { projectId } 
    });
  };

  const loadSecrets = (projectId: string, environment: string) => {
    if (!projectId || !environment) return;
    
    setLoading(true);
    vscode.postMessage({ 
      type: 'loadSecrets', 
      data: { projectId, environment } 
    });
  };

  const handleProjectInputSubmit = () => {
    const trimmedInput = projectInput.trim();
    if (!trimmedInput) {
      setProjectError('Please enter a project ID or slug');
      return;
    }

    setProjectLoading(true);
    setProjectError('');
    setError('');
    setEnvironments([]);
    setSelectedEnvironment('');
    setSecrets([]);
    
    console.log(`Submitting project ID: ${trimmedInput}`);
    vscode.postMessage({ 
      type: 'loadProject', 
      data: { workspaceId: trimmedInput } 
    });
    
    // Set a timeout to handle cases where the API doesn't respond
    setTimeout(() => {
      if (projectLoading) {
        setProjectLoading(false);
        setProjectError('Request timed out. Please check your connection and try again.');
      }
    }, 10000); // 10 second timeout
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProject(projectId);
    setSelectedEnvironment('');
    setSecrets([]);
    if (projectId) {
      loadEnvironments(projectId);
    }
  };

  const handleEnvironmentChange = (environment: string) => {
    setSelectedEnvironment(environment);
    vscode.postMessage({
      type: 'setProjectEnvironment',
      data: { projectId: selectedProject, environment }
    });
    if (selectedProject && environment) {
      loadSecrets(selectedProject, environment);
    }
  };

  const renderAuthSection = () => (
    <div className="auth-section">
      <h2>🔐 Infisical Universal Auth</h2>
      <div className="form-group">
        <label htmlFor="region">Region:</label>
        <select
          id="region"
          value={authState.region}
          onChange={(e) => setAuthState(prev => ({ ...prev, region: e.target.value as 'US' | 'EU' }))}
          disabled={loading}
        >
          <option value="US">🇺🇸 US (us.infisical.com)</option>
          <option value="EU">🇪🇺 EU (eu.infisical.com)</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="clientId">Client ID:</label>
        <input
          id="clientId"
          type="text"
          value={authState.clientId}
          onChange={(e) => setAuthState(prev => ({ ...prev, clientId: e.target.value }))}
          placeholder="Enter your Universal Auth Client ID"
          disabled={loading}
        />
        <small className="field-hint">
          Get your credentials from your Infisical project's Universal Auth configuration
        </small>
      </div>
      <div className="form-group">
        <label htmlFor="clientSecret">Client Secret:</label>
        <input
          id="clientSecret"
          type="password"
          value={authState.clientSecret}
          onChange={(e) => setAuthState(prev => ({ ...prev, clientSecret: e.target.value }))}
          placeholder="Enter your Universal Auth Client Secret"
          disabled={loading}
        />
        <small className="field-hint">
          This will be securely stored in VS Code's secret storage
        </small>
      </div>
      <button 
        onClick={handleLogin} 
        disabled={loading || !authState.clientId || !authState.clientSecret}
        className="primary-button"
      >
        {loading ? 'Authenticating...' : 'Login with Universal Auth'}
      </button>
      <div className="auth-help">
        <p>
          <strong>Need credentials?</strong> 
          <a href={`https://${authState.region.toLowerCase()}.infisical.com`} target="_blank" rel="noopener noreferrer">
            Open Infisical Dashboard
          </a>
        </p>
        <details>
          <summary>How to get Universal Auth credentials</summary>
          <ol>
            <li>Go to your Infisical project settings</li>
            <li>Navigate to "Access Control" → "Machine Identities"</li>
            <li>Create a new Universal Auth identity</li>
            <li>Copy the Client ID and Client Secret</li>
          </ol>
        </details>
      </div>
    </div>
  );

  const renderProjectEnvironmentSelector = () => (
    <div className="selector-section">
      <h3>📁 Project & Environment</h3>
      
      <div className="form-group">
        <label htmlFor="projectInput">Project ID or Slug:</label>
        <div className="input-with-button">
          <input
            id="projectInput"
            type="text"
            value={projectInput}
            onChange={(e) => setProjectInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleProjectInputSubmit()}
            placeholder="Enter project ID (e.g., cm12345abcd) or slug (e.g., my-project)"
            disabled={projectLoading}
          />
          <button
            onClick={handleProjectInputSubmit}
            disabled={projectLoading || !projectInput.trim()}
            className="submit-button"
          >
            {projectLoading ? '🔄' : '✓'}
          </button>
        </div>
        <small className="field-hint">
          Enter your project ID or slug to load environments and verify access
        </small>
        {projectError && (
          <div className="error-message">
            ❌ {projectError}
            {projectError.includes('Access denied') && (
              <div className="error-actions">
                <a href={`https://${authState.region.toLowerCase()}.infisical.com`} target="_blank" rel="noopener noreferrer">
                  Check permissions in dashboard
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {projects.length > 0 && (
        <div className="form-group">
          <label htmlFor="project">Or select from recent projects:</label>
          <select
            id="project"
            value={selectedProject}
            onChange={(e) => {
              const project = projects.find(p => p.id === e.target.value);
              if (project) {
                setProjectInput(project.name || project.id);
                handleProjectChange(e.target.value);
              }
            }}
          >
            <option value="">Select a recent project...</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {environments.length > 0 && (
        <div className="form-group">
          <label htmlFor="environment">Environment:</label>
          <select
            id="environment"
            value={selectedEnvironment}
            onChange={(e) => handleEnvironmentChange(e.target.value)}
          >
            <option value="">Select an environment...</option>
            {environments.map(env => (
              <option key={env.id} value={env.slug}>
                {env.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  const renderSecretsTable = () => (
    <div className="secrets-section">
      <h3>🔑 Secrets ({secrets.length})</h3>
      {secrets.length === 0 ? (
        <p className="no-secrets">No secrets found for the selected project and environment.</p>
      ) : (
        <div className="secrets-table">
          <div className="table-header">
            <div className="table-cell">Key</div>
            <div className="table-cell">Last Updated</div>
            <div className="table-cell">Actions</div>
          </div>
          {secrets.map(secret => (
            <div key={secret.id} className="table-row">
              <div className="table-cell secret-key">{secret.key}</div>
              <div className="table-cell">{new Date(secret.updatedAt).toLocaleDateString()}</div>
              <div className="table-cell">
                <button className="action-button" title="Edit">✏️</button>
                <button className="action-button" title="Delete">🗑️</button>
                <button className="action-button" title="AI Explain">🤖</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="control-panel">
      <header className="panel-header">
        <h1>🤖 Infisical AI Control Panel</h1>
        {authState.isAuthenticated && (
          <button onClick={handleLogout} className="logout-button">
            Logout
          </button>
        )}
      </header>

      {error && (
        <div className="error-banner">
          ❌ {error}
        </div>
      )}

      {!authState.isAuthenticated ? (
        renderAuthSection()
      ) : (
        <div className="authenticated-content">
          {renderProjectEnvironmentSelector()}
          {selectedProject && selectedEnvironment && renderSecretsTable()}
        </div>
      )}

      <footer className="panel-footer">
        <p>Powered by Infisical AI • VS Code Extension v0.1.0</p>
      </footer>
    </div>
  );
};