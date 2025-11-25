import BaseBehaviorTreeRootAction from './BaseBehaviorTreeRootAction';
//have to add import because GUTS loads collections alphabetically, this will tell webpack to bundle in the correct order;

class AbilitiesTreeRootAction extends BaseBehaviorTreeRootAction {

    //script not needed (besides base extension), just select a behaviorTree in the editor above (should be the AbilitiesBehaviorTree).
}
