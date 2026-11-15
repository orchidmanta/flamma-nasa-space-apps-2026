// ================= BM / EN button: Malay with Google Translate =================
// Google's free website translator (unofficial now, so it could stop working one day).
// How it works: Google reads a cookie "googtrans=/en/ms" and translates the page into Malay.
// Clicking BM sets the cookie and reloads; clicking EN removes it and reloads.
// Parts marked class="notranslate" (tables, investigation names, the FLAMMA logo) stay in English.
// The page text is sent to Google only after someone clicks BM.

const LANG_COOKIE = "googtrans";
const langBtn = document.getElementById("lang-toggle");

function readLangCookie() {
  const m = document.cookie.match(/(?:^|;\s*)googtrans=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}
const inMalay = () => readLangCookie() === "/en/ms";

function setLangCookie(value) {
  // Google may set the cookie on the host and on ".host", so set/clear both
  const host = location.hostname;
  const domains = ["", `; domain=${host}`, `; domain=.${host}`];
  domains.forEach(d => {
    document.cookie = value
      ? `${LANG_COOKIE}=${value}; path=/${d}`
      : `${LANG_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
  });
}

// load Google's translator (only needed when Malay is on)
function loadGoogleTranslate() {
  window.googleTranslateElementInit = () => {
    new google.translate.TranslateElement({ pageLanguage: "en", includedLanguages: "ms", autoDisplay: false },
      "google_translate_element");
    // newer versions don't always apply the cookie by themselves: pick Malay in Google's (hidden) menu
    let tries = 0;
    const pick = setInterval(() => {
      const combo = document.querySelector(".goog-te-combo");
      if (combo && combo.options.length > 1) {
        combo.value = "ms";
        combo.dispatchEvent(new Event("change"));
        clearInterval(pick);
      } else if (++tries > 40) clearInterval(pick);   // give up after ~10 s
    }, 250);
  };
  const s = document.createElement("script");
  s.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
  s.async = true;
  s.onerror = () => {   // blocked or switched off by Google: go back to English
    setLangCookie("");
    showLang(false);
    langBtn.title = "Google Translate isn't available right now";
  };
  document.head.appendChild(s);
}

function showLang(malay) {
  langBtn.classList.toggle("is-ms", malay);   // highlights EN or BM
  document.querySelector(".gt-credit").hidden = !malay;
  langBtn.setAttribute("aria-label", malay ? "Switch back to English" : "Terjemah ke Bahasa Melayu");
  langBtn.title = malay ? "English" : "Bahasa Melayu";
  document.documentElement.classList.toggle("lang-ms", malay);
}

langBtn.addEventListener("click", () => {
  setLangCookie(inMalay() ? "" : "/en/ms");
  location.reload();
});

showLang(inMalay());
if (inMalay()) loadGoogleTranslate();
