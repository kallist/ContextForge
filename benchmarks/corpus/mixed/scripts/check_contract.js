export function validateProfileContract(document) {
  const required = document.components.schemas.Profile.required;
  return required.includes("userId") && required.includes("displayName");
}
