import { useAuth } from '../../context/AuthContext';

export default function DefaultPasswordBanner() {
  const { mustChangePassword } = useAuth();

  if (!mustChangePassword) return null;

  return (
    <div className="alert-sentry alert-sentry-warn default-password-banner">
      <strong>Default credentials are in use.</strong>
      {' '}
      Change password before field deployment.
      {' '}
      <a href="/system" className="banner-link">Go to System → Change Password</a>
    </div>
  );
}
