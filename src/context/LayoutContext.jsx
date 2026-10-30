import { useProjectAccess } from "./ProjectAccessContext";
import { createContext, useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { queryConfig } from "../utils/queryConfig";

import useMobileViewport from "../hooks/useMobileViewport";

export const LayoutContext = createContext(null);

const defaultLayout = {
  header: true,
  sidebar: true,
  issues: true,
  toolbar: true,
  dbmlEditor: false,
  readOnly: false,
};

export default function LayoutContextProvider({ children }) {
  const [searchParams] = useSearchParams();
  const { role } = useProjectAccess();
  const isMobile = useMobileViewport();
  const desktopSidebar = useRef(true);
  const previousMobile = useRef(isMobile);

  const hideHeaderParam = searchParams.get(queryConfig.hideHeader.key);
  const hideSidebarParam = searchParams.get(queryConfig.hideSidebar.key);
  const hideToolbarParam = searchParams.get(queryConfig.hideToolbar.key);

  const [layout, setLayout] = useState({
    ...defaultLayout,
    header: queryConfig.hideHeader.isActive(hideHeaderParam)
      ? false
      : defaultLayout.header,
    sidebar: queryConfig.hideSidebar.isActive(hideSidebarParam)
      ? false
      : !isMobile && defaultLayout.sidebar,
    toolbar: queryConfig.hideToolbar.isActive(hideToolbarParam)
      ? false
      : defaultLayout.toolbar,
  });

  useEffect(() => {
    if (previousMobile.current === isMobile) return;
    previousMobile.current = isMobile;
    setLayout((current) => {
      if (isMobile) desktopSidebar.current = current.sidebar;
      return { ...current, sidebar: isMobile ? false : desktopSidebar.current };
    });
  }, [isMobile]);

  const effectiveLayout = {
    ...layout,
    readOnly: role === "viewer" || layout.readOnly,
    header: queryConfig.hideHeader.isForced(hideHeaderParam)
      ? false
      : layout.header,
    sidebar: queryConfig.hideSidebar.isForced(hideSidebarParam)
      ? false
      : layout.sidebar,
    toolbar: queryConfig.hideToolbar.isForced(hideToolbarParam)
      ? false
      : layout.toolbar,
  };

  return (
    <LayoutContext.Provider
      value={{
        layout: effectiveLayout,
        setLayout,
        isMobile,
        canShowSidebar: !queryConfig.hideSidebar.isForced(hideSidebarParam),
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}
