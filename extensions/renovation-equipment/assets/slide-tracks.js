export const SLIDE_TRACK_RATE_TWD = 1800;

export const QUOTED_SLIDE_TRACKS = Object.freeze([
    Object.freeze({
        id: "track-main-bath-hall",
        roomId: "bath-main",
        doorId: "main-bath-hall",
        name: "滑門軌道－主浴門",
        quotedLengthM: 0.8,
    }),
    Object.freeze({
        id: "track-bedroom-3-studio",
        roomId: "studio",
        doorId: "bedroom-3-studio",
        name: "滑門軌道－臥室3／工作室拉門",
        quotedLengthM: 0.8,
    }),
]);

export function materialIncludesTrack(material) {
    return material === "wood-slide";
}
