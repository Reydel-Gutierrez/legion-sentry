import { useState } from 'react';
import { Form } from 'react-bootstrap';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">LC</div>
          <div>
            <div className="brand-logo">Legion Controls</div>
            <div className="brand-product">Sentry G1</div>
            <div className="brand-code">LCG1DEV10026</div>
          </div>
        </div>

        <h1 className="login-title">Appliance Login</h1>
        <p className="login-subtitle">Local device access only</p>

        {error && (
          <div className="alert-sentry alert-sentry-error">{error}</div>
        )}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Username</Form.Label>
            <Form.Control
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </Form.Group>
          <Form.Group className="mb-4">
            <Form.Label>Password</Form.Label>
            <Form.Control
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Form.Group>
          <button type="submit" className="btn btn-sentry-primary w-100" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </Form>

        <p className="login-footnote">
          Default credentials are configured on first boot. Change password after first login.
        </p>
      </div>
    </div>
  );
}
