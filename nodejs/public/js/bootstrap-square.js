(async function () {
  try {
    const res = await fetch("/api/config/square");
    const config = await res.json();

    if (!res.ok || !config.scriptUrl) {
      throw new Error("Missing Square script configuration");
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = config.scriptUrl;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load Square SDK"));
      document.head.appendChild(script);
    });

    const mainScript = document.createElement("script");
    mainScript.src = "js/main.js";
    document.body.appendChild(mainScript);
  } catch (err) {
    console.error("Bootstrap Square error:", err);
  }
})();