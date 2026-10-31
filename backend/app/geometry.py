"""WGS84 polygons for impact assessment, never interpreted as robot-map coordinates."""
from shapely.geometry import LineString, Polygon
from fastapi import HTTPException


def validate_polygon(points: list[dict]) -> Polygon:
    try:
        if not 3 <= len(points) <= 500:
            raise ValueError('Use between 3 and 500 vertices')
        if any(not (-180 <= p['lng'] <= 180 and -90 <= p['lat'] <= 90) for p in points):
            raise ValueError('Coordinates are outside longitude/latitude ranges')
        polygon = Polygon([(p['lng'], p['lat']) for p in points])
        if not polygon.is_valid or polygon.is_empty or polygon.area <= 1e-12:
            raise ValueError('Polygon must have positive area and no self-intersections')
        return polygon
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc


def remaining_path(mission: dict):
    """Progress is distance along a polyline, not a count of visited vertices."""
    from shapely.ops import substring
    line = LineString([(p['lng'], p['lat']) for p in mission.get('activePoints', mission['points'])])
    return substring(line, min(1, max(0, mission['progress'] / 100)), 1, normalized=True)


def affected(polygon: list[dict], missions: list[dict]) -> list[str]:
    zone = validate_polygon(polygon)
    return [m['id'] for m in missions if zone.intersects(remaining_path(m))]
