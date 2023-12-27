# Linear release sync

Add release label on linear tickets found in PRs merged in base branch since last release


## Usage

```yaml
      - name: Sync linear tickets
        uses: rayonapp/linear-sync@main
        continue-on-error: true
        with:
            token: ${{ secrets.GITHUB_TOKEN }}
            linearApiKey: ${{ secrets.LINEAR_API_KEY }}
            releaseLabel: ${{ steps.bump-version.outputs.tag }}
```
