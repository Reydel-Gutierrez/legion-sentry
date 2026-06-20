import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BrandIdentity from '../components/common/BrandIdentity';

export default function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('Legion');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const from = location.state?.from || '/';

  if (!loading && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <aside className="login-brand-panel" aria-label="Product branding">
          <BrandIdentity
            size="login"
            textClassName="login-brand-text"
            className="brand-identity--login-panel"
          />
        </aside>

        <main className="login-form-panel">
          <h1 className="login-title">Sign In</h1>

          {error && (
            <div className="alert-sentry alert-sentry-error login-error">{error}</div>
          )}

          <Form className="login-form" onSubmit={handleSubmit}>
            <Form.Group className="login-field">
              <Form.Label>Username</Form.Label>
              <Form.Control
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </Form.Group>
            <Form.Group className="login-field login-field-password">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Form.Group>
            <div className="login-submit">
              <button type="submit" className="btn btn-sentry-primary w-100" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign In'}
              </button>
            </div>
          </Form>
        </main>
      </div>
    </div>
  );
}
