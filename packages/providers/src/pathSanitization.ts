export function removeInvalidPathCharacters(value: string) {
  return [...value]
    .filter(
      (character) =>
        character.charCodeAt(0) > 0x1f && !'<>:"/\\|?*'.includes(character)
    )
    .join("");
}
