import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ARTICLES } from "./articles";
import { Home } from "./home";
import { ArticlePage, NotFound, Shell } from "./layout";
import { usePath } from "./router";
import "./index.css";

function App() {
  const path = usePath();
  const article = ARTICLES.find((a) => a.path === path);
  return <Shell>{path === "/" ? <Home /> : article ? <ArticlePage key={path} article={article} /> : <NotFound />}</Shell>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
