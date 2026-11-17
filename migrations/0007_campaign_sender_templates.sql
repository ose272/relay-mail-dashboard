ALTER TABLE campaign_deliveries ADD COLUMN template_id TEXT REFERENCES templates(id);

UPDATE campaign_deliveries
SET template_id = (
  SELECT template_id FROM campaigns WHERE campaigns.id = campaign_deliveries.campaign_id
)
WHERE template_id IS NULL;
