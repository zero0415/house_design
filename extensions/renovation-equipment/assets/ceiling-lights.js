export const CEILING_LIGHT_INSTALL_UNIT_PRICE_TWD = 1200;
export const CEILING_LIGHT_PLACEHOLDER_MODEL = "吸頂燈（燈具型號待選）";

export const LIVING_CEILING_LIGHTS = Object.freeze([
    Object.freeze({
        id: "living-ceiling-light-01",
        name: "客廳吸頂燈－沙發區",
        placement: Object.freeze({ x: 0.51, y: 0.226 }),
    }),
    Object.freeze({
        id: "living-ceiling-light-02",
        name: "客廳吸頂燈－電視側",
        placement: Object.freeze({ x: 0.656, y: 0.382 }),
    }),
]);

export const CEILING_LIGHTS = Object.freeze([
    ...LIVING_CEILING_LIGHTS.map((entry) =>
        Object.freeze({ ...entry, roomId: "living-dining" })),
    Object.freeze({
        id: "living-ceiling-light-03",
        roomId: "living-dining",
        name: "客廳吸頂燈－臥室2旁",
        placement: Object.freeze({ x: 0.501, y: 0.927 }),
    }),
    Object.freeze({
        id: "master-ceiling-light",
        roomId: "master",
        name: "主臥吸頂燈",
        placement: Object.freeze({ x: 0.618, y: 0.680 }),
    }),
    Object.freeze({
        id: "bedroom-1-ceiling-light",
        roomId: "bedroom-1",
        name: "臥室1吸頂燈",
        placement: Object.freeze({ x: 0.531, y: 0.512 }),
    }),
    Object.freeze({
        id: "bedroom-2-ceiling-light",
        roomId: "bedroom-2",
        name: "臥室2吸頂燈",
        placement: Object.freeze({ x: 0.505, y: 0.502 }),
    }),
    Object.freeze({
        id: "bedroom-3-ceiling-light",
        roomId: "bedroom-3",
        name: "臥室3吸頂燈",
        placement: Object.freeze({ x: 0.508, y: 0.467 }),
    }),
    Object.freeze({
        id: "studio-ceiling-light",
        roomId: "studio",
        name: "工作室吸頂燈",
        placement: Object.freeze({ x: 0.536, y: 0.541 }),
    }),
    Object.freeze({
        id: "balcony-ceiling-light",
        roomId: "balcony",
        name: "陽台防潮吸頂燈",
        placement: Object.freeze({ x: 0.365, y: 0.368 }),
    }),
]);
