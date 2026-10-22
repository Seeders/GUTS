/**
 * BoneAttachment - things held or worn on a skeleton's bones: a unit's `render.equipment`
 * entries { slot, item, attachmentData: { bone, offset {x,y,z}, rotation {x,y,z} (degrees), scale {x,y,z} } }.
 *
 * The attachment is the item's transform in its bone's own frame: the item is made a child of the
 * bone, at offset, turned by rotation (Euler XYZ, degrees), sized by scale. The Graphics Editor, the
 * Attachment Editor and a game's runtime all go through here, so an item sits the same everywhere.
 *
 *   BoneAttachment.bones(root)                    Map of bone name -> bone ("mixamorig:" prefixes kept and
 *                                                 also under their bare name)
 *   BoneAttachment.findBone(bones, data, slot)    the named bone, else the slot's usual bones, else a name match
 *   BoneAttachment.apply(object, data)            set the object's transform from the attachment data
 *   BoneAttachment.attach(root, object, data, slot)  both: the object onto its bone (returns the bone or null)
 *   BoneAttachment.normalize(data)                every field present, numbers
 *   BoneAttachment.stored(data)                   as saved: identity parts left out
 */
class BoneAttachment {
    static SLOT_BONES = {
        mainHand: ['RightHand', 'Hand_R', 'hand_R', 'R_Hand', 'hand.R', 'RightHand_End', 'RHand', 'right_hand', 'HandR'],
        offHand: ['LeftHand', 'Hand_L', 'hand_L', 'L_Hand', 'hand.L', 'LeftHand_End', 'LHand', 'left_hand', 'HandL'],
        head: ['Head', 'head', 'Head_M', 'head_end', 'Head_End', 'HeadTop_End', 'neck_01', 'Neck', 'neck'],
        chest: ['Spine2', 'spine2', 'Chest', 'chest', 'spine_02', 'Spine_02', 'UpperChest', 'upper_chest', 'Spine1'],
        back: ['Spine2', 'spine2', 'Chest', 'chest', 'spine_02', 'Spine_02', 'UpperChest', 'upper_chest', 'Spine1'],
        legs: ['Hips', 'hips', 'Pelvis', 'pelvis', 'spine_01', 'Spine_01', 'UpperLeg_R', 'RightUpLeg'],
        feet: ['RightFoot', 'Foot_R', 'foot_R', 'LeftFoot', 'Foot_L', 'foot_L'],
        waist: ['Spine', 'spine', 'Hips', 'hips', 'pelvis', 'Pelvis', 'spine_01', 'Spine_01', 'Root', 'root']
    };

    static bareName(name) { return String(name || '').replace(/^mixamorig\d*[:_]?/, ''); }

    static bones(root) {
        const map = new Map();
        root?.traverse?.(o => {
            if (!o.isBone) return;
            map.set(o.name, o);
            const bare = BoneAttachment.bareName(o.name);
            if (!map.has(bare)) map.set(bare, o);
        });
        return map;
    }

    static findBone(bones, data, slot = null) {
        const want = data?.bone;
        if (want && bones.has(want)) return bones.get(want);
        if (want && bones.has(BoneAttachment.bareName(want))) return bones.get(BoneAttachment.bareName(want));
        for (const name of BoneAttachment.SLOT_BONES[slot] || []) if (bones.has(name)) return bones.get(name);
        if (slot) {
            const s = slot.toLowerCase();
            for (const [name, bone] of bones) {
                const n = name.toLowerCase();
                if (n.includes(s) || s.includes(n.replace(/[_\-.]/g, ''))) return bone;
            }
        }
        return null;
    }

    static normalize(data) {
        const v = (o, d) => ({ x: o?.x != null ? +o.x : d, y: o?.y != null ? +o.y : d, z: o?.z != null ? +o.z : d });
        return { ...(data || {}), bone: data?.bone || '', offset: v(data?.offset, 0), rotation: v(data?.rotation, 0), scale: v(data?.scale, 1) };
    }

    static stored(data) {
        const n = BoneAttachment.normalize(data), out = { ...n };
        if (!out.bone) delete out.bone;
        if (['x', 'y', 'z'].every(a => n.scale[a] === 1)) delete out.scale;
        return out;
    }

    static apply(object, data) {
        if (!object) return;
        const n = BoneAttachment.normalize(data), D = Math.PI / 180;
        object.position.set(n.offset.x, n.offset.y, n.offset.z);
        object.rotation.set(n.rotation.x * D, n.rotation.y * D, n.rotation.z * D, 'XYZ');
        object.scale.set(n.scale.x, n.scale.y, n.scale.z);
    }

    static attach(root, object, data, slot = null, bones = null) {
        const bone = BoneAttachment.findBone(bones || BoneAttachment.bones(root), data, slot);
        (bone || root).add(object);
        BoneAttachment.apply(object, data);
        return bone;
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.BoneAttachment = BoneAttachment; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.BoneAttachment = BoneAttachment; }
export default BoneAttachment;
export { BoneAttachment };
