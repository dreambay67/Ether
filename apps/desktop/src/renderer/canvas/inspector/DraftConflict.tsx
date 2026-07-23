export function DraftConflict({ onLatest, onRebase }: { onLatest(): void; onRebase(): void }) {
  return <div className="inspector-draft-conflict" role="alert"><strong>Saved settings changed elsewhere.</strong><span>Your unsaved draft is preserved. Choose which base to continue from before saving.</span><div className="inspector-actions"><button type="button" onClick={onLatest}>Use latest saved</button><button type="button" onClick={onRebase}>Rebase my draft</button></div></div>;
}
