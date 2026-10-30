import { useEffect, useState } from "react";

export const MOBILE_EDITOR_QUERY = "(max-width: 760px)";
export default function useMobileViewport() {
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(MOBILE_EDITOR_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(MOBILE_EDITOR_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
