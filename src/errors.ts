/**
 * Errors of ria-stac: one base class with the problems of what was passed, for display and logging.
 */
import type {StacError} from "./client.js";

/**
 * One problem found in what the application passed: a STAC selection or a filter.
 *
 * Every error of this library carries a list of these in {@link RiaStacError.problems}, so a user interface shows
 * them all the same way.
 *
 * @category Errors
 */
export interface RiaStacProblem {
    /**
     * Where the problem is, as a JSON path into what was passed: `"datetime"` or `"where.eo:cloud_cover"` (STAC
     * selection), `"maxItems"`; `""` for the whole value.
     */
    path: string;
    /** `"error"`: it cannot work as given; `"warning"`: it works, but perhaps not as expected. */
    severity: "error" | "warning";
    /** What is wrong, in English, for display. */
    message: string;
}

/**
 * The base class of every error this library throws or rejects with: {@link StacError}. Built-in errors
 * (`RangeError` for invalid options, the signal's reason when a request is aborted) are not of this class.
 *
 * One shape for display and logging: `message`, `name` (the class), {@link RiaStacError.problems} (possibly empty)
 * and {@link RiaStacError.details} (the fields of the subclass, such as `status` and `url`). `JSON.stringify(error)`
 * gives all of it, see {@link RiaStacError.toJSON}.
 *
 * @example
 * ```ts
 * const url = ...;          // what the user typed
 * const errorBox = ...;     // an element of your page
 * try {
 *     const client = await StacClient.connect(url);
 * } catch (e) {
 *     if (!(e instanceof RiaStacError)) throw e;
 *     errorBox.textContent = [e.message, ...e.problems.map((p) => `${p.severity} ${p.path}: ${p.message}`)].join("\n");
 *     console.table(e.details());
 * }
 * ```
 *
 * @category Errors
 */
export class RiaStacError extends Error {
    /** The problems one by one (path, severity, message); empty when the error is not about a value passed. */
    readonly problems: RiaStacProblem[];

    /**
     * Creates an error. Applications normally only catch these errors; the library creates them.
     *
     * @param message human readable description, available as `error.message`
     * @param problems the problems one by one; default none
     */
    constructor(message: string, problems: RiaStacProblem[] = []) {
        super(message);
        this.name = "RiaStacError";
        this.problems = problems;
    }

    /**
     * The fields of the subclass that are set, for display: for example `{status: 404, url: "..."}` for a
     * {@link StacError}. A lower-level error (`originalError`) is given as its message.
     * `name`, `message`, `stack` and `problems` are not included.
     *
     * @returns a new object with every field that is not undefined
     */
    details(): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(this)) {
            if (value === undefined || key === "name" || key === "message" || key === "stack" || key === "problems") continue;
            out[key] = value instanceof Error ? value.message : value;
        }
        return out;
    }

    /**
     * The error as JSON, for logs: `JSON.stringify(error)` calls it.
     *
     * @returns `{name, message, problems, ...details()}`
     */
    toJSON(): Record<string, unknown> {
        return {name: this.name, message: this.message, problems: this.problems, ...this.details()};
    }
}
