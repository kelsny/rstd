import deepEqual from "deep-equal";
import { cloned } from "./helpers/cloned.js";
import { toIter } from "./helpers/toIter.js";
import { toNumber } from "./helpers/toNumber.js";
import type { IterResolvable, NumberResolvable, Ord } from "./types.js";
import { Namespaced } from "./utils/namespaced.js";
import { ResolveTo, UseResolvables } from "./utils/resolvable.js";

@UseResolvables()
@Namespaced("Iter<T>", { errors: true })
export class Iter<T> {
    #iter: Iterator<T, unknown, undefined>;

    #done = false;

    #consumed = false;

    #fused = { called: false, dead: false };

    constructor(i: Iterator<T, unknown, undefined>) {
        this.#iter = i;
    }

    next() {
        if (this.#consumed) throw new ReferenceError(`this iterator has been consumed and cannot be used`);

        if (this.#fused.dead) return undefined;

        const { value, done } = this.#iter.next();

        this.#done = !!done;

        if (this.#fused.called && typeof value === "undefined") this.#fused.dead = true;

        return !done ? value : undefined;
    }

    next_if(func: (item: T) => boolean) {
        const item = this.peek();

        //TODO: need Option<T> type
        if (typeof item === "undefined") return undefined;

        if (func.call(undefined, item)) return this.next()!;

        return undefined;
    }

    next_if_eq(expected: T) {
        return this.next_if((item) => deepEqual(item, expected));
    }

    advance_by(n: number) {
        if (n < 0 || !Number.isInteger(n)) throw new TypeError(`n is not a nonnegative integer`);

        for (let i = 0; i < n; i++, this.next()) {
            if (this.#done) return i;
        }

        return undefined;
    }

    all(f: (item: T) => boolean) {
        let item = this.next();

        while (!this.#done) {
            if (!f.call(undefined, item!)) return false;

            item = this.next();
        }

        return true;
    }

    any(f: (item: T) => boolean) {
        let item = this.next();

        while (!this.#done) {
            if (f.call(undefined, item!)) return true;

            item = this.next();
        }

        return false;
    }

    by_ref() {
        const i = new Iter(this.#iter);

        i.#done = this.#done;
        i.#consumed = this.#consumed;

        return i;
    }

    chain(other: IterResolvable<T>): Iter<T>;
    chain(@ResolveTo(Iter) other: Iter<T>) {
        this.#consumed = true;
        other.#consumed = true;

        return new Iter({
            next: function (this: Iter<T>) {
                const { value, done } = this.#iter.next();

                if (done) return other.#iter.next();

                return { value, done };
            }.bind(this),
        });
    }

    cloned() {
        const [next, done] = cloned(this.#iter);

        this.#iter = (function* () {
            while (true) {
                const x = next(0);

                if (x === done) break;

                yield x;
            }
        })();

        return new Iter(
            (function* () {
                while (true) {
                    const x = next(1);

                    if (x === done) break;

                    yield structuredClone(x);
                }
            })(),
        );
    }

    // cmp(other: IterResolvable<T>): Ord;
    cmp(@ResolveTo(Iter) other: Iter<T>) {
        // TODO: decide what this method does
    }

    cmp_by(other: IterResolvable<T>, cmp: (self: T, other: T) => number): Ord;
    cmp_by(@ResolveTo(Iter) other: Iter<T>, cmp: (self: T, other: T) => number) {
        while (!this.#done && !other.#done) {
            const a = this.next();
            const b = other.next();

            const ord = cmp.call(undefined, a!, b!);

            if (ord !== 0) return Number.isNaN(ord) ? 0 : (Math.sign(ord) as Ord);
        }

        this.#consumed = true;
        other.#consumed = true;

        if (!this.#done) return 1;

        if (!other.#done) return -1;

        return 0;
    }

    collect() {
        const result: T[] = [];

        while (!this.#done) result.push(this.next()!);

        this.#consumed = true;

        result.pop();

        return result;
    }

    collect_into(collection: T[]) {
        collection.push(...this.collect());

        return collection;
    }

    copied() {
        return this.cloned();
    }

    count() {
        return this.collect().length;
    }

    cycle() {
        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                while (true) {
                    this.#consumed = false;

                    const source = this.cloned();

                    let item;
                    while (!(item = source.#iter.next()).done) yield item.value;

                    this.#consumed = true;
                }
            }.call(this),
        );
    }

    enumerate() {
        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                let i = 0;

                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) yield [i++, item] as [number, T];
                } while (!this.#done);
            }.call(this),
        );
    }

    eq(other: IterResolvable<T>): boolean;
    eq(@ResolveTo(Iter) other: Iter<T>) {
        return this.eq_by(other, deepEqual);
    }

    eq_by(other: IterResolvable<T>, eq: (self: T, other: T) => boolean): boolean;
    eq_by(@ResolveTo(Iter) other: Iter<T>, eq: (self: T, other: T) => boolean) {
        while (!this.#done && !other.#done) {
            const a = this.next();
            const b = other.next();

            const same = eq.call(undefined, a!, b!);

            if (!same) return false;
        }

        this.#consumed = true;
        other.#consumed = true;

        if (!this.#done || !other.#done) return false;

        return true;
    }

    filter(f: (item: T) => boolean) {
        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    let item = this.next();

                    while (!this.#done && !f.call(undefined, item!)) item = this.next();

                    if (!this.#done) yield item as T;

                    this.#consumed = true;
                } while (!this.#done);
            }.call(this),
        );
    }

    filter_map(
        f: (item: T) => {
            /* TODO: need Option<T> type */
        },
    ) {}

    find(f: (item: T) => boolean) {
        return this.filter(f).next();
    }

    find_map(
        f: (item: T) => {
            /* TODO: need Option<T> type */
        },
    ) {
        // return this.filter_map(f).next();
    }

    flat_map<U>(f: (item: T) => IterResolvable<U>) {
        // return this.map(f).flatten();
    }

    flatten(): [T] extends [IterResolvable<infer U>] ? Iter<U> : never;
    flatten() {
        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) {
                        if (!item || typeof item !== "object") throw new TypeError(`unable to flatten this value`);

                        const source = toIter(item!);

                        do {
                            const el = source.next();

                            if (!source.#done) yield el;
                        } while (!source.#done);
                    }
                } while (!this.#done);
            }.call(this),
        );
    }

    fold<U>(init: U, f: (folded: U, item: T) => U) {
        this.#consumed = true;

        do {
            this.#consumed = false;

            const item = this.next();

            this.#consumed = true;

            if (!this.#done) init = f.call(undefined, init, item!);
        } while (!this.#done);

        return init;
    }

    for_each(f: (item: T) => void) {
        this.#consumed = true;

        do {
            this.#consumed = false;

            const item = this.next();

            this.#consumed = true;

            if (!this.#done) f.call(undefined, item!);
        } while (!this.#done);
    }

    fuse() {
        this.#fused.called = true;

        return this;
    }

    // ge(other: IterResolvable<T>): boolean;
    ge(@ResolveTo(Iter) other: Iter<T>) {}

    // gt(other: IterResolvable<T>): boolean;
    gt(@ResolveTo(Iter) other: Iter<T>) {}

    inspect(f: (item: T) => void) {
        this.#consumed = true;

        return new Iter<T>(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    f.call(undefined, item!);

                    if (!this.#done) yield item as T;

                    this.#consumed = true;
                } while (!this.#done);
            }.call(this),
        );
    }

    intersperse<U>(separator: U) {
        this.#consumed = true;

        let emitted = false;

        return new Iter<T | U>(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) {
                        if (emitted) yield structuredClone(separator);
                        yield item as T;
                        emitted = true;
                    }
                } while (!this.#done);
            }.call(this),
        );
    }

    intersperse_with<U>(separator: () => U) {
        this.#consumed = true;

        let emitted = false;

        return new Iter<T | U>(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) {
                        if (emitted) yield separator.call(undefined);
                        yield item as T;
                        emitted = true;
                    }
                } while (!this.#done);
            }.call(this),
        );
    }

    is_partitioned(predicate: (item: T) => boolean) {
        let partitioned = false;

        do {
            const item = this.next();

            if (!this.#done) {
                const result = predicate.call(undefined, item!);

                if (!result) partitioned = true;

                if (partitioned && result) return false;
            }
        } while (!this.#done);

        this.#consumed = true;

        return true;
    }

    is_sorted() {}

    is_sorted_by() {}

    is_sorted_by_key() {}

    last() {
        let last, item;

        while (!this.#done) [last, item] = [item, this.next()];

        return last;
    }

    // le(other: IterResolvable<T>): boolean;
    le(@ResolveTo(Iter) other: Iter<T>) {}

    // lt(other: IterResolvable<T>): boolean;
    lt(@ResolveTo(Iter) other: Iter<T>) {}

    map<U>(f: (item: T) => U): Iter<U> {
        this.#consumed = true;

        return new Iter<U>(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    if (!this.#done) yield f.call(undefined, item!);

                    this.#consumed = true;
                } while (!this.#done);
            }.call(this),
        );
    }

    map_while(
        predicate: (item: T) => {
            /* TODO: need Option<T> type */
        },
    ) {}

    max() {}

    max_by() {}

    max_by_key() {}

    min() {}

    min_by() {}

    min_by_key() {}

    ne(other: IterResolvable<T>): boolean;
    ne(@ResolveTo(Iter) other: Iter<T>) {
        return !this.eq(other);
    }

    next_chunk(n: number) {
        if (n < 0 || !Number.isInteger(n)) throw new TypeError(`n is not a nonnegative integer`);

        const result: T[] = [];

        for (let i = 0; i < n; i++) {
            const item = this.next();

            if (this.#done && i !== n) return result;

            result.push(item!);
        }

        return result;
    }

    nth(n: number) {
        if (n < 0 || !Number.isInteger(n)) throw new TypeError(`n is not a nonnegative integer`);

        for (let i = 0; i < n - 1; i++) {
            this.next();
        }

        return this.next();
    }

    // partial_cmp(other: IterResolvable<T>): Ord | undefined;
    partial_cmp(@ResolveTo(Iter) other: Iter<T>) {}

    // partial_cmp_by(other: IterResolvable<T>, partial_cmp: (self: T, other: T) => Ord | undefined): Ord | undefined;
    partial_cmp_by(@ResolveTo(Iter) other: Iter<T>, partial_cmp: (self: T, other: T) => Ord | undefined) {}

    partition(f: (item: T) => boolean) {
        const result = [[], []] as [T[], T[]];

        do {
            const item = this.next();

            if (!this.#done) {
                const bool = f.call(undefined, item!);

                result[+!bool].push(item!);
            }
        } while (!this.#done);

        this.#consumed = true;

        return result;
    }

    partition_in_place(predicate: (item: T) => boolean) {}

    peek() {
        const peeked = this.#iter.next();

        const source = this.#iter;

        this.#iter = function* (this: Iter<T>) {
            if (peeked.done) return;

            yield peeked.value;

            let item;

            while (!item?.done) yield (item = source.next()).value as T;
        }.call(this);

        return peeked.done ? undefined : (peeked.value as T);
    }

    peek_mut() {
        return this.peek();
    }

    position(predicate: (item: T) => boolean) {
        let item = this.next();

        let index = 0;

        while (!this.#done) {
            if (predicate.call(undefined, item!)) return index;

            this.#consumed = false;

            item = this.next();

            this.#consumed = true;

            index++;
        }

        return undefined;
    }

    product(): [T] extends [NumberResolvable] ? number : never;
    product() {
        return this.fold(1, (product, item) => product * toNumber(item));
    }

    reduce(f: (reduced: T, item: T) => T) {
        if (this.#done) return undefined;

        let init = this.next();

        do {
            this.#consumed = false;

            const item = this.next();

            this.#consumed = true;

            if (!this.#done) init = f.call(undefined, init!, item!);
        } while (!this.#done);

        return init;
    }

    rev() {}

    rposition() {}

    scan<S, U>(initial_state: S, f: (_: { state: S }, item: T) => U) {
        this.#consumed = true;

        return new Iter<U>(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) {
                        const _ = { state: initial_state };

                        yield f.call(undefined, _, item!);

                        initial_state = _.state;
                    }
                } while (!this.#done);
            }.call(this),
        );
    }

    size_hint() {}

    skip(n: number) {
        if (n < 0 || !Number.isInteger(n)) throw new TypeError(`n is not a nonnegative integer`);

        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                this.#consumed = false;

                while (n--) this.next();

                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) yield item as T;
                } while (!this.#done);
            }.call(this),
        );
    }

    skip_while(predicate: (item: T) => boolean) {
        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                this.#consumed = false;

                let item = this.#iter.next();
                while (!item.done && predicate.call(undefined, item.value)) item = this.#iter.next();

                yield item.value;

                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) yield item as T;
                } while (!this.#done);
            }.call(this),
        );
    }

    step_by(step: number) {
        if (step <= 0 || !Number.isInteger(step)) throw new TypeError(`n is not a positive integer`);

        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                do {
                    this.#consumed = false;

                    const item = this.next();

                    let n = step;
                    while (--n) this.next();

                    this.#consumed = true;

                    yield item as T;
                } while (!this.#done);
            }.call(this),
        );
    }

    sum(): [T] extends [NumberResolvable] ? number : never;
    sum() {
        return this.fold(0, (product, item) => product + toNumber(item));
    }

    take(n: number) {
        if (n < 0 || !Number.isInteger(n)) throw new TypeError(`n is not a nonnegative integer`);

        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                this.#consumed = false;

                do {
                    if (!n--) return;

                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) yield item as T;
                } while (!this.#done);
            }.call(this),
        );
    }

    take_while(predicate: (item: T) => boolean) {
        this.#consumed = true;

        return new Iter(
            function* (this: Iter<T>) {
                this.#consumed = false;

                do {
                    this.#consumed = false;

                    const item = this.next();

                    this.#consumed = true;

                    if (!this.#done) {
                        if (!predicate.call(undefined, item!)) return;

                        yield item as T;
                    }
                } while (!this.#done);
            }.call(this),
        );
    }

    try_collect() {}

    try_find() {}

    try_fold() {}

    try_for_each() {}

    try_reduce() {}

    unzip(): T extends readonly [infer A, infer B] ? [A[], B[]] : never;
    unzip() {
        const collection = this.collect();

        return collection.reduce<[unknown[], unknown[]]>(
            (tuple, item) => {
                const [a, b] = item as [unknown, unknown];

                return [tuple[0].concat(a), tuple[1].concat(b)];
            },
            [[], []],
        );
    }

    zip<U>(other: IterResolvable<U>): Iter<[T, U]>;
    zip<U>(@ResolveTo(Iter) other: Iter<U>) {
        this.#consumed = true;
        other.#consumed = true;

        return new Iter<[T, U]>({
            next: function (this: Iter<T>) {
                const a = this.#iter.next();
                const b = other.#iter.next();

                if (a.done || b.done) return { value: undefined, done: true as true };

                return { value: [a.value, b.value] as [T, U], done: false as false };
            }.bind(this),
        });
    }
}