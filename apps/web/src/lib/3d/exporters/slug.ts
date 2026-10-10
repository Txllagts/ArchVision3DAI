/**
 * Normaliza un texto a un slug apto para nombres de archivo, de material MTL y
 * de objeto OBJ: sin acentos, sin espacios, solo minusculas, digitos y guiones.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
