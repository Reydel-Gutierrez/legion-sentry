const VARIANT_CLASS = {
  primary: 'btn-sentry-primary',
  secondary: 'btn-sentry-secondary',
  danger: 'btn-sentry-danger',
};

export default function ActionButton({
  variant = 'secondary',
  size,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const variantClass = VARIANT_CLASS[variant] || VARIANT_CLASS.secondary;
  const sizeClass = size === 'sm' ? ' btn-sm' : '';
  return (
    // eslint-disable-next-line react/button-has-type
    <button
      type={type}
      className={`btn ${variantClass}${sizeClass}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
