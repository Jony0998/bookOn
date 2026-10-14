/** Safely embed a value inside an inline <script> (escapes quotes and </script>) */
const toScriptString = (value: unknown) =>
  JSON.stringify(String(value))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

/** Build an alert page, optionally redirecting afterwards */
export const alertScript = (message: unknown, redirectTo?: string) =>
  `<script> alert(${toScriptString(message)});${
    redirectTo ? ` window.location.replace(${toScriptString(redirectTo)});` : ""
  } </script>`;
