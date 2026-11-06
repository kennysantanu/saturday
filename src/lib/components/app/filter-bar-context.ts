/** Shared between FilterBar and FilterToggle so the toggle can sit inside a page's control row. */
export const filterBarKey = Symbol('filter-bar');

export type FilterBarContext = {
	readonly open: boolean;
	readonly label: string;
	readonly count: number;
	readonly panelId: string;
	toggle: () => void;
};
