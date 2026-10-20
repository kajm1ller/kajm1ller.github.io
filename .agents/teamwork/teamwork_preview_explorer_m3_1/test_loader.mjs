export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && context.parentURL && context.parentURL.includes('teamwork_preview_explorer_m3_1')) {
        if (specifier.endsWith('.js') && !specifier.includes('proposed_traffic')) {
            const target = specifier.replace('./', 'file:///C:/Users/potat/kajm1ller.github.io-1/js/game/');
            return nextResolve(target, context);
        }
    }
    return nextResolve(specifier, context);
}
