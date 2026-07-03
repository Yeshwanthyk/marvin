import { createEffect, createSignal } from "solid-js"
import { discoverWorkspaceProjects, type WorkspaceProject } from "@yeshwanthyk/runtime-effect/workspace-projects.js"

type WorkspaceProjectRoots = Parameters<typeof discoverWorkspaceProjects>[0]

export interface UseWorkspaceProjectDiscoveryDeps {
	projectRoots: () => WorkspaceProjectRoots
}

export const useWorkspaceProjectDiscovery = ({ projectRoots }: UseWorkspaceProjectDiscoveryDeps) => {
	const [projects, setProjects] = createSignal<WorkspaceProject[]>([])

	const refreshProjects = () => {
		setProjects(discoverWorkspaceProjects(projectRoots()))
	}

	createEffect(() => {
		projectRoots()
		refreshProjects()
	})

	return {
		projects,
		refreshProjects,
	}
}
