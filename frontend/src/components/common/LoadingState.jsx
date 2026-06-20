import SentryLogo from './SentryLogo';

export default function LoadingState({ message = 'Loading…', className = '' }) {
  return (
    <div className={`loading-state${className ? ` ${className}` : ''}`}>
      <SentryLogo size="compact" className="loading-state-logo" />
      <p>{message}</p>
    </div>
  );
}
