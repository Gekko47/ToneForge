declare global {
  namespace Office {
    enum InsertBreakBehavior {
      Paragraph,
      LineBreak,
      PageBreak,
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
      getSelection(): Range;
    }

    interface Body {
      text: string;
      load: (prop: "text") => Body;
    }

    interface Range {
      text: string;
      insertText(text: string, insertMode?: "Replace" | "Insert" | "Start" | "End"): Range;
      insertBreak(breakType: InsertBreakBehavior): void;
      insertParagraph(text: string): Paragraph;
      paragraphs: ParagraphCollection;
      font: Font;
      load: (...props: Array<string>) => Range;
    }

    interface ParagraphCollection {
      load: (prop: string) => ParagraphCollection;
      items: Paragraph[];
    }

    interface Paragraph {
      format: ParagraphFormat;
      load: (prop: string) => Paragraph;
    }

    interface ParagraphFormat {
      // placeholder for future properties
    }

    interface Font {
      name: string;
      size: number;
      color: string;
      load: (...props: Array<string>) => Font;
    }

    interface Styles {
      name: string;
      load: (prop: string) => Styles;
      items: Style[];
    }

    interface Style {
      name: string;
    }

    type Run = <R>(func: (context: Context) => Promise<R>) => Promise<R>;
  }

  const Office: {
    run: Office.Run;
    roamingSettings: {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
    };
    InsertBreakBehavior: typeof Office.InsertBreakBehavior;
  };
}

export {};
