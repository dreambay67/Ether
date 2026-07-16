type ConnectionHintProps = {
  message: string | null;
};

export function ConnectionHint({ message }: ConnectionHintProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="connection-hint" data-testid="connection-hint" role="status" aria-live="polite">
      {message}
    </div>
  );
}
