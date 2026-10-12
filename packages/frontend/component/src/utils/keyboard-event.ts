/** Includes Safari's IME confirmation, where isComposing may already be false. */
export function isComposingKeyboardEvent(event: {
  keyCode: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing: boolean };
}): boolean {
  return (
    event.isComposing === true ||
    event.nativeEvent?.isComposing === true ||
    event.keyCode === 229
  );
}
