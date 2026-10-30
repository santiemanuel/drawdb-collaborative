import { createContext, useCallback, useState } from "react";
import useCollab from "../hooks/useCollab";

export const TransformContext = createContext(null);

export default function TransformContextProvider({ children }) {
  const { stopFollowing } = useCollab();
  const [transform, setTransformInternal] = useState({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });

  /**
   * @type {typeof DrawDB.TransformContext["setTransform"]}
   */
  const setRemoteTransform = useCallback(
    (actionOrValue) => {
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const findFirstNumber = (...values) =>
        values.find((value) => typeof value === "number" && !isNaN(value));

      setTransformInternal((prev) => {
        if (typeof actionOrValue === "function") {
          actionOrValue = actionOrValue(prev);
        }

        return {
          zoom: clamp(
            findFirstNumber(actionOrValue.zoom, prev.zoom, 1),
            0.02,
            5,
          ),
          pan: {
            x: findFirstNumber(actionOrValue.pan?.x, prev.pan?.x, 0),
            y: findFirstNumber(actionOrValue.pan?.y, prev.pan?.y, 0),
          },
        };
      });
    },
    [setTransformInternal],
  );

  // Every local navigation path (wheel, drag, toolbar, keyboard) takes control.
  const setTransform = useCallback(
    (actionOrValue) => {
      stopFollowing();
      setRemoteTransform(actionOrValue);
    },
    [setRemoteTransform, stopFollowing],
  );

  return (
    <TransformContext.Provider
      value={{ transform, setTransform, setRemoteTransform }}
    >
      {children}
    </TransformContext.Provider>
  );
}
