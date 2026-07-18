import { FilePlus2, FolderOpen } from "lucide-react";
import etherLogo from "../../../../../packages/brand/src/assets/Ether_logo.png";

export function StartScreen({ message, onNew, onOpen }: {
  message: string;
  onNew(): void;
  onOpen(): void;
}) {
  return (
    <section className="start-screen task-nine-start" data-testid="start-screen">
      <img src={etherLogo} alt="Ether" />
      <h1>ETHER</h1>
      <p>{message}</p>
      <div>
        <button type="button" onClick={onNew}><FilePlus2 size={17} />New document</button>
        <button type="button" onClick={onOpen}><FolderOpen size={17} />Open document</button>
      </div>
    </section>
  );
}
