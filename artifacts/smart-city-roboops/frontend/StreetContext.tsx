import { useEffect, useRef, useState } from "react";
import type { Point } from "./models";

export function StreetContext({ point }: { point: Point }) {
  const element = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState(
    "Street View needs a configured Google Maps browser key.",
  );
  useEffect(() => {
    let cancelled = false;
    let panorama: any;
    let attempts = 0;
    setStatus(
      import.meta.env.VITE_GOOGLE_MAPS_API_KEY
        ? "Loading nearby Street View…"
        : "Street View needs a configured Google Maps browser key.",
    );
    const timer = setInterval(() => {
      const maps = (window as any).google?.maps;
      if (!maps || !element.current) {
        if (++attempts > 20) {
          clearInterval(timer);
          if (import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
            setStatus(
              "Street View unavailable. Check Google Maps configuration.",
            );
        }
        return;
      }
      clearInterval(timer);
      new maps.StreetViewService().getPanorama(
        { location: point, radius: 75 },
        (data: any, result: string) => {
          if (cancelled) return;
          if (result !== "OK" || !data?.location?.pano) {
            setStatus("No nearby Street View panorama is available.");
            return;
          }
          panorama = new maps.StreetViewPanorama(element.current, {
            pano: data.location.pano,
            addressControl: true,
            fullscreenControl: false,
            motionTracking: false,
          });
          setStatus(
            `Location context${data.imageDate ? ` · imagery ${data.imageDate}` : ""}. This is not current incident evidence.`,
          );
        },
      );
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (panorama) {
        panorama.setVisible(false);
        (window as any).google?.maps.event.clearInstanceListeners(panorama);
      }
    };
  }, [point.lat, point.lng]);
  return (
    <div className="street-context">
      <div className="subsection-title">STREET VIEW · LOCATION CONTEXT</div>
      <p>{status}</p>
      <div className="street-panorama" ref={element} />
      <a
        className="text-button"
        target="_blank"
        rel="noreferrer"
        href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat},${point.lng}`}
      >
        Open location in Google Street View ↗
      </a>
    </div>
  );
}
