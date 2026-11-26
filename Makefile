.DEFAULT_GOAL := sync
.PHONY: sync

# Switch to main and fast-forward it. --autostash stashes local changes
# (such as the model keys the settings.json filter strips) and restores them.
sync:
	git checkout main
	git pull --ff-only --autostash
