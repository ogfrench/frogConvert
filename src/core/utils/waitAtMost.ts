/** Wait for `work`, or `ms`, whichever comes first, leaving no timer behind. */
export function waitAtMost(work: Promise<unknown> | undefined, ms: number): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        const done = () => { clearTimeout(timer); resolve(); };
        Promise.resolve(work).then(done, done);
    });
}
