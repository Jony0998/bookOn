export enum ProductStatus {
    PAUSE = "PAUSE",
    PROCESS = "PROCESS",
    DELETE = "DELETE",
}

export enum ProductCollection {
    FICTION = "FICTION",
    NON_FICTION = "NON_FICTION",
    SCIENCE = "SCIENCE",
    HISTORY = "HISTORY",
    BIOGRAPHY = "BIOGRAPHY",
    CHILDREN = "CHILDREN",
    TEXTBOOK = "TEXTBOOK",
    REFERENCE = "REFERENCE",
    RELIGION = "RELIGION",
    OTHER = "OTHER",
}

/** Curated "mood" shelves shown on the home page; a book may sit on several */
export enum ProductShelf {
    CLASSIC = "CLASSIC",
    UZBEK_LIT = "UZBEK_LIT",
    GROWTH = "GROWTH",
    EVENING_TEA = "EVENING_TEA",
}

/** Language the book is written in */
export enum ProductLanguage {
    UZ = "UZ",
    RU = "RU",
    EN = "EN",
    OTHER = "OTHER",
}
