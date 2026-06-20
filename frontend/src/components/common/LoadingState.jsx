export default function LoadingState({ message = 'Loading…', className = '' }) {
  return (
    <div className={`loading-state${className ? ` ${className}` : ''}`}>
      <p>{message}</p>
    </div>
  );
}
