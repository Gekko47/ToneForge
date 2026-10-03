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

      /*
       * Event subscription, declared narrowly and optionally.
       *
       * Optional because absence is the interesting case and must stay
       * expressible: ADR-0094 recorded selection-change events as an open question
       * precisely because "not in our declarations" is not "not in the API", so a
       * required member would have forced a cast to talk to a host that may not
       * have it. Narrow because this add-in subscribes to exactly one event type
       * and models only the parts of the registration it uses.
       *
       * The event type is passed as the string Office documents
       * (`"documentSelectionChanged"`), not as an `Office.EventType` value, so the
       * declaration does not have to model a runtime class we never construct.
       */
      addHandlerAsync?: (
        eventType: string,
        callback: (event: { type: string; source?: unknown }) => void,
      ) => Promise<unknown>;
      removeHandlerAsync?: (eventType: string, options?: { id?: string }) => Promise<unknown>;

      /**
       * The host's requirement sets, and the question that matters for a member
       * added in one of them.
       *
       * Declared narrowly and optionally for the same reason as `addHandlerAsync`:
       * absence is the interesting case and has to stay expressible, because a
       * host that cannot answer reports "unsupported" rather than throwing. Narrow
       * because this add-in asks exactly one question — whether WordApiDesktop 1.4
       * is served, which is what decides whether `Range.set` exists.
       */
      requirements?: {
        isSetSupported?: (requirementSet: string, version: string) => boolean;
      };
    }

    interface Document {
      body: Body;
      selection: Range;
      styles: Styles;
      /**
       * Word JavaScript API (WordApi 1.1): `Document.sections` is the
       * `SectionCollection` of the document. Optional here because a host
       * predating the requirement set does not expose it, and the add-in
       * treats its absence as "sections unsupported" rather than an error.
       */
      sections?: SectionCollection;
      url?: string;
      id?: string;
      getSelection(): Range;
    }

    interface SectionCollection {
      load: (prop: string | string[]) => SectionCollection;
      items: Section[];
    }

    /** Word JavaScript API (WordApi 1.1): the three header/footer slots. */
    type HeaderFooterType = "Primary" | "FirstPage" | "EvenPages";

    /**
     * Word JavaScript API (WordApi 1.1). A header or footer is not a
     * collection member: `getHeader`/`getFooter` return the header/footer
     * `Body` for one `HeaderFooterType`.
     */
    interface Section {
      body: Body;
      getHeader: (type: HeaderFooterType) => Body;
      getFooter: (type: HeaderFooterType) => Body;
      load: (prop: string | string[]) => Section;
      /**
       * WordApiDesktop 1.3. **Not** on Word on the web, so a load naming it is
       * refused with the rest of the transaction. Optional here for that reason:
       * acquisition reads it in its own guarded transaction rather than folding
       * it into the shared body/section load.
       */
      pageSetup?: PageSetup;
    }

    /** WordApiDesktop 1.3. Every member below is absent on Word on the web. */
    interface PageSetup {
      orientation?: string;
      topMargin?: number;
      bottomMargin?: number;
      leftMargin?: number;
      rightMargin?: number;
      pageWidth?: number;
      pageHeight?: number;
      load: (prop: string | string[]) => PageSetup;
    }

    interface TableCollection {
      load: (prop: string | string[]) => TableCollection;
      items: Table[];
    }

    /**
     * Word JavaScript API (WordApi 1.3). Every property below was read from
     * `Word.Interfaces.TableLoadOptions` rather than assumed:
     * <https://learn.microsoft.com/javascript/api/word/word.interfaces.tableloadoptions>
     *
     * Note what is absent: there is no cell style name. `cellStyleName` on the
     * DTO stays `null`, which the analyzer reads as "not read".
     */
    interface Table {
      style?: string;
      styleBuiltIn?: string;
      values?: string[][];
      rowCount?: number;
      headerRowCount?: number;
      load: (prop: string | string[]) => Table;
    }

    interface Body {
      text: string;
      load: (prop: string | string[]) => Body;
      paragraphs?: ParagraphCollection;
      /**
       * Word JavaScript API (WordApi 1.3): the tables in this body.
       */
      tables?: TableCollection;
      /** Word JavaScript API (WordApi 1.1): the body's own style name. */
      style?: string;
      styleBuiltIn?: string;
      font?: Font;
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
      /**
       * Word JavaScript API (WordApi 1.1): the character offset at which the
       * range starts, and one past the last character it covers. Both are
       * read-only, so they are declared as loadable-and-readable rather than
       * assigned.
       *
       * Optional here for the ADR-0084 reason: the capture in
       * `word/selectionScope.ts` reads them through a guarded view and refuses
       * an anchor it cannot offset, so a host that omits them degrades to a
       * stated refusal instead of a load that takes the whole transaction with
       * it.
       */
      start?: number;
      end?: number;
      font: Font;
      /**
       * One argument, or the call is not the API's. ADR-0100.
       *
       * This was declared variadic so that `load("text", "start", "end")` would
       * typecheck. The host takes `propertyNames: string | string[]`, loads the
       * first, and **silently ignores the rest** \u2014 so the following read of
       * `.start` threw "The property 'start' is not available", in a real Word,
       * with 2 350 tests green. A declaration widened to accommodate a call is
       * the same lie ADR-0084 records for a property that does not exist: both
       * make the type system agree with something the host does not do.
       *
       * Pass an array: `load(["text", "start", "end"])`.
       */
      load: (propertyNames: string | string[]) => Range;
      getRange?: (rangeLocation: RangeLocation) => Range;
    }

    interface ParagraphCollection {
      load: (prop: string) => ParagraphCollection;
      items: Paragraph[];
    }

    interface Paragraph {
      format: ParagraphFormat;
      text?: string;
      /**
       * Word JavaScript API (WordApi 1.1): the host-assigned identity of this
       * paragraph. Optional because a `SelectionRangeView`-style guarded read
       * treats it as absent rather than inventing one — a fabricated node id
       * would satisfy the type and fail at write time.
       */
      uniqueLocalId?: string;
      /**
       * WordApi **1.3**: `Paragraph.getRange("Whole")` resolves this paragraph to
       * a Range \u2014 not 1.1, as ADR-0103 and this declaration both claimed until
       * a real Word reported a caret whose offsets came back inverted and sent the
       * caret path into a guard written for drags (ADR-0105). `manifest.xml`
       * requires WordApi 1.1, so a host below 1.3 has no such method and the
       * runtime check below is load-bearing rather than defensive.
       *
       * Optional because the revision adapter checks for it at runtime
       * and refuses a paragraph-unit change with a stated reason when a host
       * does not expose it.
       */
      getRange?: (rangeLocation: "Whole") => Range;
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
      /** One argument, or the call is not the API's. ADR-0100; see `Range.load`. */
      load: (propertyNames: string | string[]) => Font;
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

    /**
     * How the pane is currently presented, as Office spells it.
     *
     * Named because the handler receives it and a caller has to compare against
     * something; the string union is the shape Microsoft documents.
     */
    type VisibilityMode = "Taskpane" | "TaskpaneFooter" | "Hidden";

    /**
     * Payload of `onVisibilityModeChanged`.
     */
    interface VisibilityModeChangedMessage {
      visibilityMode: VisibilityMode;
    }

    /**
     * `Office.addin`, the surface that shows and hides the task pane.
     *
     * **Every member is optional, and the reason is not tidiness.** These exist
     * only on a **shared runtime** (SharedRuntime 1.1), so a host without one has
     * no `addin` object at all. A required member would force every caller to
     * cast to talk to a host that may not have it \u2014 which is ADR-0084's failure
     * mode, and exactly what this add-in did for five attempts: each call was a
     * hand-rolled `(globalThis as { Office?: { addin?: ... } })` cast, so no
     * compiler ever checked the shape against the documented one.
     *
     * Declared now, and declared the way the host declares it, so that a host
     * that lacks the surface is a runtime answer rather than a type error.
     */
    interface Addin {
      /**
       * Shows the task pane associated with the add-in.
       *
       * Takes **no pane id** \u2014 there is no overload \u2014 and only promises to show
       * "the task pane associated with the add-in". When the host cannot resolve
       * one it has been observed opening the shared runtime's function file
       * instead (ADR-0107). Prefer a task pane command in the manifest, where
       * Office resolves the pane itself.
       */
      showAsTaskpane(): Promise<void>;
      /** Hides the task pane. Visibility only \u2014 it does not unload the pane. */
      hide(): Promise<void>;
      /**
       * Fires when the pane is shown or hidden. Shared runtime only.
       *
       * Returns the deregister handler, which is itself asynchronous \u2014 await it
       * before relying on the removal having happened.
       */
      onVisibilityModeChanged(
        handler: (message: VisibilityModeChangedMessage) => void,
      ): Promise<() => Promise<void>>;
    }
  }

  interface Actions {
    associate: (id: string, handler: (event: { completed: () => void }) => Promise<void>) => void;
  }

  const Office: {
    /**
     * Absent on a host without a shared runtime. See `Office.Addin`.
     */
    addin?: Office.Addin;
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
