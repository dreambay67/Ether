export type CanvasAcceleratorCommand = "createModule" | "dissolveModule";

type BeforeInput = {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  isAutoRepeat?: boolean;
};

export function canvasCommandForAccelerator(input: BeforeInput): CanvasAcceleratorCommand | null {
  if (
    input.type !== "keyDown" ||
    input.isAutoRepeat === true ||
    !(input.control || input.meta) ||
    input.alt ||
    input.key.toLocaleLowerCase() !== "g"
  ) return null;
  return input.shift ? "dissolveModule" : "createModule";
}
