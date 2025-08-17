export type Clue = {
    topic: string;
    money: string | number | null;
    question: string;
    answer: string;
  };
  
  export type Annotation = {
    review: boolean;
    category: string;
  };
  
  export type ShowMeta = {
    id: string;           // hash of CSV
    title: string;        // file name
    uploadedAt: number;
    // Optional metadata parsed from CSV columns shared by all rows
    airDate?: string;
    gameType?: string;
    showId?: string;      // original J-Archive show id if provided
    stats?: {
      total: number;
      marked: number;
      correct: number;
      coryat: number;
      lastReviewedAt?: number;
    };
  };
  
  export type ShowData = {
    id: string;
    fileText: string;                          // raw CSV
    annotations: Record<number, Annotation>;   // from your reviewer
    lastIndex: number;
    settings: { shuffle: boolean; reviewOnly: boolean };
    // Snapshot of parsed metadata for convenient access in Review
    meta?: {
      air_date?: string;
      game_type?: string;
      show_id?: string;
    };
  };