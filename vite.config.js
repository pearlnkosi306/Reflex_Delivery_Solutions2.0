import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` makes every built asset path relative instead of rooted at
// "/". That's what lets the exact same build work whether it's served from
// a domain root or from a GitHub Pages project subpath like
// "https://<user>.github.io/<repo>/" — without needing to hardcode the repo
// name here and risk a blank page if it's ever renamed or forked.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
