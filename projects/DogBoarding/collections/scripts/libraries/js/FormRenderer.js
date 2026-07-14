/**
 * FormRenderer - builds a form from its schema in the `forms` collection.
 *
 * Every form in this app - the public intake form and all nine admin dialogs -
 * is described by JSON, not by JavaScript. Adding a field to a dog, or a new
 * payment method, is an edit in the GUTS editor, not a code change.
 *
 * A field may name `optionsFrom: "<collectionId>"`, and its dropdown is filled
 * from that collection (sorted by `order`, labelled by `title`, valued by the
 * object's id). `clientVets` is the one runtime-supplied list, since a client's
 * vets come from the database rather than the collections.
 */
class FormRenderer {
    constructor(engine) {
        this.engine = engine;
    }

    get collections() {
        return this.engine.collections;
    }

    get ui() {
        return GUTS.DogBoardUI;
    }

    schema(formId) {
        const form = this.collections.forms?.[formId];
        if (!form) console.error(`[FormRenderer] No form schema named '${formId}'.`);
        return form || { fields: [] };
    }

    /**
     * Turn a collection into [{ value, label }], ordered by `order`.
     * The object's key in the collection is the value - that is what the
     * database stores, so `rabies.json` yields value "rabies".
     */
    optionsFromCollection(collectionId, extra = {}) {
        if (extra[collectionId]) return extra[collectionId];

        const collection = this.collections[collectionId];
        if (!collection) {
            console.warn(`[FormRenderer] optionsFrom references unknown collection '${collectionId}'.`);
            return [];
        }

        return Object.entries(collection)
            .map(([value, item]) => ({
                value,
                label: item.title || value,
                order: item.order ?? 999
            }))
            .sort((a, b) => a.order - b.order)
            .map(({ value, label }) => ({ value, label }));
    }

    /**
     * Render one field. `values` supplies the current value, `extra` supplies
     * any runtime option lists (e.g. { clientVets: [...] }).
     */
    field(spec, values = {}, extra = {}) {
        const { el } = this.ui;
        const value = values[spec.name];

        const options = spec.optionsFrom
            ? this.optionsFromCollection(spec.optionsFrom, extra)
            : (spec.options || []);

        // `money` is a number input that reads and writes cents.
        if (spec.type === 'money') {
            return this.ui.field({
                name: spec.name,
                label: spec.label,
                type: 'number',
                step: '0.01',
                min: spec.min ?? 0,
                required: spec.required,
                hint: spec.hint,
                placeholder: spec.placeholder,
                value: value === undefined || value === null || value === ''
                    ? '' : this.ui.centsToInput(value)
            });
        }

        if (spec.type === 'file') {
            return el('label.field',
                el('span.field__label', spec.label),
                el('input', { type: 'file', name: spec.name, accept: spec.accept || undefined }),
                spec.hint ? el('small.hint', spec.hint) : null);
        }

        return this.ui.field({
            name: spec.name,
            label: spec.label,
            type: spec.type || 'text',
            value,
            options,
            required: !!spec.required,
            hint: spec.hint || '',
            placeholder: spec.placeholder || '',
            min: spec.min,
            max: spec.max,
            step: spec.step,
            rows: spec.rows || 3
        });
    }

    /**
     * Lay fields out, pairing consecutive `half: true` fields into a row so the
     * schema controls the shape of the form as well as its content.
     */
    fields(specs, values = {}, extra = {}) {
        const { el } = this.ui;
        const out = [];
        let row = [];

        const flushRow = () => {
            if (row.length === 1) out.push(row[0]);
            else if (row.length > 1) out.push(el('div.field-row', row));
            row = [];
        };

        for (const spec of specs) {
            const node = this.field(spec, values, extra);
            if (spec.half) {
                row.push(node);
                if (row.length === 3) flushRow();
            } else {
                flushRow();
                out.push(node);
            }
        }
        flushRow();

        return out;
    }

    /** The whole form body: fieldsets if the schema has them, else a flat list. */
    render(formId, values = {}, extra = {}) {
        const { el } = this.ui;
        const schema = this.schema(formId);

        if (Array.isArray(schema.fieldsets)) {
            return el('div', schema.fieldsets.map(set =>
                el('section.fieldset',
                    el('header.fieldset__head',
                        el('h2', set.legend),
                        set.hint ? el('p.muted', set.hint) : null),
                    el('div.fieldset__body', this.fields(set.fields || [], values, extra)))));
        }

        return el('div', this.fields(schema.fields || [], values, extra));
    }

    /** Just the fields, no fieldset chrome - for dialogs. */
    renderFields(formId, values = {}, extra = {}) {
        const { el } = this.ui;
        const schema = this.schema(formId);

        const specs = Array.isArray(schema.fieldsets)
            ? schema.fieldsets.flatMap(set => set.fields || [])
            : (schema.fields || []);

        return el('div', this.fields(specs, values, extra));
    }

    /** Every field the schema declares, flattened. */
    fieldSpecs(formId) {
        const schema = this.schema(formId);
        return Array.isArray(schema.fieldsets)
            ? schema.fieldsets.flatMap(set => set.fields || [])
            : (schema.fields || []);
    }

    /**
     * Read a rendered form back out, using the schema to decide types: a `money`
     * field comes back as cents, a checkbox as a boolean, everything else as a
     * trimmed string.
     */
    read(formId, container) {
        const data = {};

        for (const spec of this.fieldSpecs(formId)) {
            const input = container.querySelector(`[name="${spec.name}"]`);
            if (!input) continue;

            if (spec.type === 'checkbox') data[spec.name] = input.checked;
            else if (spec.type === 'file') data[spec.name] = input.files[0] || null;
            else if (spec.type === 'money') data[spec.name] = this.ui.toCents(input.value);
            else data[spec.name] = input.value.trim();
        }

        return data;
    }
}
