// The Waterline API docs: Swagger UI reading the API's own description
// (GET /v1/openapi.json, served by the api function, so it always matches
// what's deployed). Keys pasted into Authorize stay in this tab's memory
// and go only to the API.

(() => {
  'use strict';

  // ---- config -------------------------------------------------------------
  // Staging for now. For production, change this one line (and the
  // connect-src in index.html's Content-Security-Policy).
  const API = 'https://omxtckxgcybejfnyngxq.supabase.co/functions/v1/api';
  // -------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  // Not inside another site's frame: a framed Authorize box could be tricked.
  if (window.top !== window.self) {
    document.body.textContent = 'This page can’t be shown inside another site.';
    return;
  }

  $('base-url').textContent = API;
  $('spec-link').href = `${API}/v1/openapi.json`;

  $('copy-base').addEventListener('click', async () => {
    const button = $('copy-base');
    try {
      await navigator.clipboard.writeText(API);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select it to copy';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });

  if (!window.SwaggerUIBundle) {
    $('swagger-ui').innerHTML =
      '<p class="error">Couldn’t load the docs viewer. Check your connection and reload.</p>';
    return;
  }

  window.SwaggerUIBundle({
    url: `${API}/v1/openapi.json`,
    dom_id: '#swagger-ui',
    layout: 'BaseLayout',
    deepLinking: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 0,
    defaultModelExpandDepth: 2,
    displayRequestDuration: true,
    requestSnippetsEnabled: true,
    // Never saved: the key is gone when the tab closes.
    persistAuthorization: false,
    // Don't send the description to swagger.io to be checked.
    validatorUrl: null,
  });
})();
