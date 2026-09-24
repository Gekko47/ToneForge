declare global {
  namespace Office {
    enum InsertBreakBehavior {
      Paragraph,
      LineBreak,
      PageBreak,
    }

    /**
     * Word.BreakType mirrors the Office.InsertBreakBehavior enum values.
     * Desktop Word (2026-09-21 probe) does not expose Office.InsertBreakBehavior,
     * so the adapter references Word.BreakType directly when available.
     */
    enum BreakType {
      NextParagraph = 0,
      LineBreak = 1,
      PageBreak = 2,
    }

    /**
     * Word.InsertLocation controls where `Range.insertBreak` inserts the break.
     */
    enum InsertLocation {
      Before = 0,
      After = 1,
      Start = 2,
      End = 3,
    }

    interface Context {
      document: Document;
      host: {
        name: string;
        version: string;
      };
      sync(): Promise<void>;
    }

    interface Document {
      body: Body;
      selection: Range;
      styles: Styles;
      url?: string;
      id?: string;
      getSelection(): Range;
    }

    interface Body {
      text: string;
      load: (prop: "text") => Body;
      paragraphs?: ParagraphCollection;
      /**
       * Word JavaScript API: `Body.getRange(rangeLocation)` accepts a
       * RangeLocation ("Start", "End", "All", "Whole", or a custom range
       * object). It is NOT a numeric (start, length) API.
       */
      getRange: (rangeLocation: RangeLocation) => Range;
    }

    /**
     * RangeLocation accepted by Body.getRange / Selection.getRange.
     */
    type RangeLocation = "Start" | "End" | "All" | "Whole" | { start: number; end: number };

    interface Range {
      text: string;
      insertText(text: string, insertMode?: "Replace" | "Insert" | "Start" | "End"): Range;
      /**
       * Word JavaScript API (WordApiDesktop 1.4): `Range.set({ start, end })`
       * narrows a Range to the given character offsets. This is the supported
       * way to resolve a Change.range offset pair into a live Range.
       */
      set: (properties: { start?: number; end?: number }) => Range;
      /**
       * Word JavaScript API: named style on the range.
       */
      style: string;
      /**
       * Word JavaScript API: paragraph formatting object.
       */
      paragraphFormat: ParagraphFormat;
      /**
       * Word JavaScript API: list formatting object.
       */
      listFormat: ListFormat;
      insertBreak(breakType: BreakType, insertLocation: InsertLocation): void;
      insertParagraph(text: string): Paragraph;
      paragraphs: ParagraphCollection;
      font: Font;
      load: (...props: Array<string>) => Range;
      getRange?: (rangeLocation: RangeLocation) => Range;
    }

    interface ParagraphCollection {
      load: (prop: string) => ParagraphCollection;
      items: Paragraph[];
    }

    interface Paragraph {
      format: ParagraphFormat;
      text?: string;
      load: (prop: string) => Paragraph;
      insertText?: (text: string, insertMode?: string) => Paragraph;
    }

    interface ParagraphFormat {
      set: (properties: Record<string, unknown>) => ParagraphFormat;
      setListLevel?: (level: number) => void;
      space1?: () => ParagraphFormat;
      space1Pt5?: () => ParagraphFormat;
      space2?: () => ParagraphFormat;
    }

    interface ListFormat {
      set: (properties: Record<string, unknown>) => ListFormat;
    }

    interface Font {
      name: string;
      size: number;
      color: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      load: (...props: Array<string>) => Font;
      set: (properties: Record<string, unknown>) => Font;
      reset: () => void;
    }

    interface Styles {
      name: string;
      load: (prop: string) => Styles;
      items: Style[];
    }

    interface Style {
      name: string;
      apply?: () => void;
    }

    type Run = <R>(func: (context: Context) => Promise<R>) => Promise<R>;

    /**
     * Host enumeration used by `Office.context.host` and `Office.onReady`.
     */
    type HostType = "Word" | "Excel" | "PowerPoint" | "Outlook" | "Project";

    interface HostInfo {
      host: HostType;
      platform: string;
    }

    /**
     * Readiness hook fired by Word desktop/web once the Office.js runtime is
     * initialised and `Word.run` is available. Preferred over the legacy
     * `Office.initialize` callback.
     */
    type OnReadyCallback = (info: HostInfo) => void;
  }

  interface Actions {
    associate: (id: string, handler: (event: { completed: () => void }) => Promise<void>) => void;
  }

  const Office: {
    /**
     * Legacy test-double entry point. The real Word host does not expose
     * `Office.run`; production code must use `Word.run`.
     */
    run?: Office.Run;
    roamingSettings: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
      saveAsync?: (callback?: (result: unknown) => void) => void;
    };
    InsertBreakBehavior: typeof Office.InsertBreakBehavior;
    /**
     * Modern readiness hook. Called by the host after the runtime is ready.
     */
    actions?: Office.Actions;
    onReady: (callback: Office.OnReadyCallback) => void;
    /**
     * Legacy readiness hook. Still supported but `onReady` is preferred.
     */
    initialize: (callback: () => void) => void;
    /**
     * Runtime context populated after `onReady`/`initialize` fires.
     */
    context: Office.Context;
    /**
     * Host name, e.g. "Word".
     */
    host: { name: Office.HostType; version: string };
  };

  const Word: {
    run: Office.Run;
    BreakType: typeof Office.BreakType;
    InsertLocation: typeof Office.InsertLocation;
  };
}

export {};
